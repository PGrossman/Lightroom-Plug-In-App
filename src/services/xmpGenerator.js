// src/services/xmpGenerator.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class XMPGenerator {
  constructor(databaseService) {
    this.db = databaseService;
    this.personalData = null;
  }

  /**
   * Load personal data from database (cached)
   */
  async loadPersonalData() {
    if (this.personalData) {
      return this.personalData;
    }

    try {
      // ✅ FIX: Use prepare().get() for better-sqlite3
      const data = this.db.prepare('SELECT * FROM personal_data WHERE id = 1').get();
      
      if (data) {
        this.personalData = data;
        logger.info('Personal data loaded for XMP generation', { 
          creatorName: data.creatorName 
        });
      } else {
        // Fallback to defaults if no personal data exists
        this.personalData = {
          creatorName: 'Philip Ethan Grossman',
          email: '',
          copyrightNotice: '© 2025 Philip Ethan Grossman. All Rights Reserved.'
        };
        logger.warn('No personal data found, using defaults');
      }
      
      return this.personalData;
    } catch (error) {
      logger.error('Failed to load personal data', { error: error.message });
      // Return defaults on error
      return {
        creatorName: 'Philip Ethan Grossman',
        email: '',
        copyrightNotice: '© 2025 Philip Ethan Grossman. All Rights Reserved.'
      };
    }
  }

  /**
   * Generate XMP files for entire cluster (all files, derivatives, similar clusters)
   */
  async generateXMPFiles({ cluster, metadata, affectedImages }) {
    try {
      logger.info('Starting XMP generation', { 
        clusterRep: cluster.mainRep?.representativeFilename,
        totalAffectedImages: affectedImages?.length || 0,
        hasGPS: !!(metadata.gps?.latitude || metadata.gps?.longitude)
      });
      
      // Log GPS data if present
      if (metadata.gps?.latitude || metadata.gps?.longitude) {
        logger.info('📍 GPS Data found - will propagate to all cluster images', {
          latitude: metadata.gps.latitude,
          longitude: metadata.gps.longitude,
          altitude: metadata.gps.altitude,
          source: metadata.gps.source || 'unknown'
        });
      }

      // ✅ COMPLETE: Collect ALL files that need XMP
      const allFilesToProcess = new Set();
      
      // 1. Main representative
      if (cluster.mainRep?.representativePath) {
        allFilesToProcess.add(cluster.mainRep.representativePath);
      }
      
      // 2. All images in main cluster (imagePaths includes bracketed images)
      if (cluster.mainRep?.imagePaths && Array.isArray(cluster.mainRep.imagePaths)) {
        cluster.mainRep.imagePaths.forEach(path => allFilesToProcess.add(path));
      }
      
      // 3. All derivatives of main cluster
      // ✅ FIX: Derivatives are at cluster.mainRep.derivatives (top level of mainRep)
      if (cluster.mainRep?.derivatives && Array.isArray(cluster.mainRep.derivatives)) {
        cluster.mainRep.derivatives.forEach(path => allFilesToProcess.add(path));
      }
      // Also check cluster.derivatives (alternative location from process-images)
      if (cluster.derivatives && Array.isArray(cluster.derivatives)) {
        cluster.derivatives.forEach(path => allFilesToProcess.add(path));
      }
      
      // 4. All similar representatives and their files
      if (cluster.similarReps && Array.isArray(cluster.similarReps)) {
        cluster.similarReps.forEach(simRep => {
          // Similar rep itself
          if (simRep.cluster?.representativePath) {
            allFilesToProcess.add(simRep.cluster.representativePath);
          }
          
          // All images in similar cluster (bracketed images)
          if (simRep.cluster?.imagePaths && Array.isArray(simRep.cluster.imagePaths)) {
            simRep.cluster.imagePaths.forEach(path => allFilesToProcess.add(path));
          }
          
          // Derivatives of similar cluster
          if (simRep.cluster?.derivatives && Array.isArray(simRep.cluster.derivatives)) {
            simRep.cluster.derivatives.forEach(path => allFilesToProcess.add(path));
          }
        });
      }
      
      // 5. Also check the allClusters array if it exists (contains all clusters in the group)
      if (cluster.allClusters && Array.isArray(cluster.allClusters)) {
        cluster.allClusters.forEach(c => {
          if (c.representativePath) allFilesToProcess.add(c.representativePath);
          if (c.imagePaths) c.imagePaths.forEach(p => allFilesToProcess.add(p));
          if (c.derivatives) c.derivatives.forEach(p => allFilesToProcess.add(p));
        });
      }
      
      // Convert Set to Array and remove any null/undefined
      const filesToProcess = Array.from(allFilesToProcess).filter(p => p);
      
      // 🔍 DEBUG: Log all files being processed
      logger.info('Files collected for XMP generation', {
        totalFiles: filesToProcess.length,
        mainRepFiles: cluster.mainRep?.imagePaths?.length || 0,
        mainRepDerivatives: cluster.mainRep?.derivatives?.length || 0,
        clusterDerivatives: cluster.derivatives?.length || 0,
        similarClusters: cluster.similarReps?.length || 0,
        allClustersCount: (cluster.similarReps?.length || 0) + 1,
        fileList: filesToProcess.map(f => path.basename(f))
      });
      
      // 🔍 DEBUG: Log cluster structure
      logger.debug('Cluster structure debug', {
        hasMainRep: !!cluster.mainRep,
        hasMainRepDerivatives: !!cluster.mainRep?.derivatives,
        hasClusterDerivatives: !!cluster.derivatives,
        mainRepKeys: cluster.mainRep ? Object.keys(cluster.mainRep) : [],
        clusterKeys: Object.keys(cluster)
      });

      // Load personal data for creator/copyright info
      const personalData = await this.loadPersonalData();

      // ✅ GPS PRIORITY LOGIC: Manual > AI Analysis > EXIF
      let gpsData = null;
      
      console.log('🔍 ========== GPS PRIORITY CHECK ==========');
      console.log('🔍 Input metadata:', JSON.stringify({
        hasGPS: !!metadata.gps,
        gps: metadata.gps,
        hasGpsAnalysis: !!metadata.gpsAnalysis,
        gpsAnalysis: metadata.gpsAnalysis,
        hasManualGPS: !!metadata.manualGPS,
        manualGPS: metadata.manualGPS
      }, null, 2));
      
      // Priority 1: Manual GPS from metadata.gps OR metadata.manualGPS
      if (metadata.gps?.latitude) {
        gpsData = {
          latitude: parseFloat(metadata.gps.latitude),
          longitude: parseFloat(metadata.gps.longitude),
          altitude: metadata.gps.altitude || null,
          source: metadata.gps.source || 'Manual Entry'
        };
        console.log('✅ Using GPS from metadata.gps:', gpsData);
        logger.info('📍 Using GPS from metadata.gps', gpsData);
      }
      else if (metadata.manualGPS?.latitude) {
        gpsData = {
          latitude: parseFloat(metadata.manualGPS.latitude),
          longitude: parseFloat(metadata.manualGPS.longitude),
          altitude: metadata.manualGPS.altitude || null,
          source: 'Manual Entry'
        };
        console.log('✅ Using GPS from metadata.manualGPS:', gpsData);
        logger.info('📍 Using GPS from metadata.manualGPS', gpsData);
      }
      // Priority 2: GPS from AI analysis (gpsAnalysis field)
      else if (metadata.gpsAnalysis?.latitude) {
        gpsData = {
          latitude: parseFloat(metadata.gpsAnalysis.latitude),
          longitude: parseFloat(metadata.gpsAnalysis.longitude),
          altitude: metadata.gpsAnalysis.altitude || null,
          source: 'AI Analysis'
        };
        console.log('✅ Using GPS from AI analysis:', gpsData);
        logger.info('📍 Using GPS from AI analysis', gpsData);
      }
      // Priority 3: GPS from EXIF (parent image)
      else if (cluster.mainRep?.gps?.latitude) {
        gpsData = {
          latitude: parseFloat(cluster.mainRep.gps.latitude),
          longitude: parseFloat(cluster.mainRep.gps.longitude),
          altitude: cluster.mainRep.gps.altitude || null,
          source: 'EXIF Data'
        };
        console.log('✅ Using GPS from EXIF:', gpsData);
        logger.info('📍 Using GPS from EXIF', gpsData);
      }
      
      // Add GPS to metadata object for XMP generation
      if (gpsData) {
        metadata.gps = gpsData;
        console.log('✅ GPS will be written to all cluster images:', gpsData);
        console.log('✅ Image count:', filesToProcess.length);
        logger.info('📍 GPS will be written to all cluster images', {
          latitude: gpsData.latitude,
          longitude: gpsData.longitude,
          altitude: gpsData.altitude,
          source: gpsData.source,
          imageCount: filesToProcess.length
        });
      } else {
        console.log('⚠️ No GPS data available for this cluster');
        logger.debug('No GPS data available for this cluster');
      }
      
      console.log('🔍 ========== END GPS PRIORITY CHECK ==========\n');

      // Generate XMP for each file
      const results = [];
      
      for (const imagePath of filesToProcess) {
        try {
          const xmpPath = this.getXMPPath(imagePath);
          const xmpContent = await this.buildXMPContent(imagePath, metadata, personalData);
          
          await fs.writeFile(xmpPath, xmpContent, 'utf8');
          
          results.push({
            imagePath,
            xmpPath,
            success: true
          });
          
          logger.debug('XMP file created', { 
            imagePath: path.basename(imagePath), 
            xmpPath: path.basename(xmpPath)
          });
          
        } catch (error) {
          logger.error('Failed to create XMP for file', { 
            imagePath, 
            error: error.message 
          });
          
          results.push({
            imagePath,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      logger.info('XMP generation complete', {
        totalFiles: filesToProcess.length,
        successCount,
        failCount
      });
      
      return {
        success: true,
        filesProcessed: filesToProcess.length,
        successCount,
        failCount,
        results
      };
      
    } catch (error) {
      logger.error('XMP generation failed', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate XMP file from metadata + EXIF data (legacy single-file method)
   */
  async generateXMP(imagePath, metadata, exifData) {
    try {
      // Load personal data
      const personalData = await this.loadPersonalData();

      // Extract year from EXIF date
      const year = this.extractYear(exifData?.DateTimeOriginal);
      
      // Use personal data for copyright, or fallback to metadata
      const copyright = personalData.copyrightNotice || 
                       `© ${year} ${personalData.creatorName}. All Rights Reserved.`;

      // Build XMP content
      const xmpContent = await this.buildXMPContent(imagePath, {
        creator: personalData.creatorName,
        copyright: copyright,
        dateCreated: exifData?.DateTimeOriginal,
        ...metadata
      }, personalData);

      // Write .xmp file (same name as image, but .xmp extension)
      const xmpPath = this.getXMPPath(imagePath);
      await fs.writeFile(xmpPath, xmpContent, 'utf8');

      logger.info('XMP file generated', { imagePath, xmpPath });

      return xmpPath;
      
    } catch (error) {
      logger.error('Failed to generate XMP', { 
        imagePath, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get XMP file path for an image
   */
  getXMPPath(imagePath) {
    const parsed = path.parse(imagePath);
    return path.join(parsed.dir, `${parsed.name}.xmp`);
  }

  /**
   * Extract year from EXIF date
   */
  extractYear(dateTimeOriginal) {
    if (!dateTimeOriginal) {
      return new Date().getFullYear();
    }
    
    // Handle different date formats
    if (typeof dateTimeOriginal === 'string') {
      // EXIF format: "2025:10:08 12:34:56"
      const yearMatch = dateTimeOriginal.match(/^(\d{4})/);
      if (yearMatch) {
        return yearMatch[1];
      }
    }
    
    if (dateTimeOriginal instanceof Date) {
      return dateTimeOriginal.getFullYear();
    }
    
    return new Date().getFullYear();
  }

  /**
   * Build XMP XML content with personal data integration
   */
  async buildXMPContent(imagePath, metadata, personalData) {
    const timestamp = new Date().toISOString();

    // 🔍 DIAGNOSTIC: Log metadata object
    console.log('🔍 buildXMPContent called');
    console.log('🔍 Metadata object:', JSON.stringify({
      title: metadata.title,
      hasGPS: !!metadata.gps,
      gps: metadata.gps,
      hasGpsAnalysis: !!metadata.gpsAnalysis,
      gpsAnalysis: metadata.gpsAnalysis
    }, null, 2));
    logger.info('buildXMPContent metadata', {
      title: metadata.title,
      hasGPS: !!metadata.gps,
      gpsLatitude: metadata.gps?.latitude,
      gpsLongitude: metadata.gps?.longitude
    });

    // Use personal data if provided, otherwise use metadata
    const creator = personalData?.creatorName || metadata.creator || '';
    const copyright = personalData?.copyrightNotice || metadata.copyright || '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 7.0.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
      xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:exif="http://ns.adobe.com/exif/1.0/">
      
      <!-- Title -->
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXML(metadata.title || '')}</rdf:li>
        </rdf:Alt>
      </dc:title>
      
      <!-- Description -->
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXML(metadata.description || '')}</rdf:li>
        </rdf:Alt>
      </dc:description>
      
      <!-- Creator -->
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${this.escapeXML(creator)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      
      <!-- Rights/Copyright -->
      <dc:rights>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXML(copyright)}</rdf:li>
        </rdf:Alt>
      </dc:rights>
      
      <!-- Copyright Status -->
      <xmpRights:Marked>${personalData?.copyrightStatus === 'copyrighted' ? 'True' : 'False'}</xmpRights:Marked>
      
      <!-- Rights Usage Terms -->
${personalData?.rightsUsageTerms ? `      <xmpRights:UsageTerms>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXML(personalData.rightsUsageTerms)}</rdf:li>
        </rdf:Alt>
      </xmpRights:UsageTerms>` : ''}
      
      <!-- Creator Contact Info -->
${this.formatCreatorContactInfo(personalData)}
      
      <!-- Keywords -->
      <dc:subject>
        <rdf:Bag>
${this.formatKeywords(metadata.keywords || [])}
        </rdf:Bag>
      </dc:subject>
      
      <!-- Headline/Caption -->
      <photoshop:Headline>${this.escapeXML(metadata.caption || '')}</photoshop:Headline>
      
      <!-- Category -->
      <photoshop:Category>${this.escapeXML(metadata.category || '')}</photoshop:Category>
      
      <!-- Scene Type -->
${metadata.sceneType ? `      <Iptc4xmpCore:Scene>
        <rdf:Bag>
          <rdf:li>${this.escapeXML(metadata.sceneType)}</rdf:li>
        </rdf:Bag>
      </Iptc4xmpCore:Scene>` : ''}
      
      <!-- Location -->
${this.formatLocation(metadata.location)}
      
      <!-- GPS Coordinates -->
${this.formatGPSData(metadata.gps)}
      
      <!-- Metadata Date -->
      <xmp:MetadataDate>${timestamp}</xmp:MetadataDate>
      <xmp:ModifyDate>${timestamp}</xmp:ModifyDate>
      
      <!-- Alt Text for Accessibility -->
${metadata.altText ? `      <Iptc4xmpCore:AltTextAccessibility>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXML(metadata.altText)}</rdf:li>
        </rdf:Alt>
      </Iptc4xmpCore:AltTextAccessibility>` : ''}
      
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
  }

  /**
   * Format GPS coordinates for XMP
   * Converts GPS data to EXIF-compliant XMP tags with validation
   */
  formatGPSData(gps) {
    // 🔍 DIAGNOSTIC: Log what we received
    console.log('🔍 formatGPSData called with:', JSON.stringify(gps, null, 2));
    logger.info('formatGPSData input', { gps });
    
    if (!gps || (!gps.latitude && gps.latitude !== 0) || (!gps.longitude && gps.longitude !== 0)) {
      console.log('❌ GPS validation failed: missing latitude or longitude');
      logger.warn('GPS validation failed: missing coordinates', { gps });
      return '';
    }
    
    let xml = '';
    
    // Convert to proper types and validate
    const lat = typeof gps.latitude === 'string' ? parseFloat(gps.latitude) : gps.latitude;
    const lon = typeof gps.longitude === 'string' ? parseFloat(gps.longitude) : gps.longitude;
    
    console.log('🔍 Parsed coordinates:', { lat, lon });
    
    // Validate coordinates
    if (isNaN(lat) || isNaN(lon)) {
      console.log('❌ GPS coordinates are NaN:', { lat, lon, originalLat: gps.latitude, originalLon: gps.longitude });
      logger.warn('Invalid GPS coordinates (NaN)', { latitude: gps.latitude, longitude: gps.longitude });
      return '';
    }
    
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      console.log('❌ GPS coordinates out of range:', { lat, lon });
      logger.warn('GPS coordinates out of range', { latitude: lat, longitude: lon });
      return '';
    }
    
    console.log('✅ GPS coordinates validated successfully:', { lat, lon });
    
    // XMP uses decimal degrees format
    xml += `      <exif:GPSLatitude>${lat}</exif:GPSLatitude>\n`;
    xml += `      <exif:GPSLongitude>${lon}</exif:GPSLongitude>\n`;
    xml += `      <exif:GPSVersionID>2.3.0.0</exif:GPSVersionID>\n`;
    
    console.log('✅ GPS XML generated successfully');
    logger.info('GPS XML generated', { lat, lon });
    
    // Optional: Altitude (in meters)
    if (gps.altitude !== undefined && gps.altitude !== null) {
      const alt = typeof gps.altitude === 'string' ? parseFloat(gps.altitude) : gps.altitude;
      if (!isNaN(alt)) {
        xml += `      <exif:GPSAltitude>${Math.abs(alt)}</exif:GPSAltitude>\n`;
        xml += `      <exif:GPSAltitudeRef>${alt >= 0 ? '0' : '1'}</exif:GPSAltitudeRef>\n`;
      }
    }
    
    return xml;
  }

  /**
   * Format creator contact information
   */
  formatCreatorContactInfo(personalData) {
    if (!personalData) return '';
    
    let xml = '';
    
    // Creator Contact Info structure
    const hasContactInfo = personalData.address || personalData.city || 
                          personalData.state || personalData.country || 
                          personalData.postalCode || personalData.phone || 
                          personalData.email || personalData.website;
    
    if (hasContactInfo) {
      xml += `      <Iptc4xmpCore:CreatorContactInfo>\n`;
      
      if (personalData.address) {
        xml += `        <Iptc4xmpCore:CiAdrExtadr>${this.escapeXML(personalData.address)}</Iptc4xmpCore:CiAdrExtadr>\n`;
      }
      if (personalData.city) {
        xml += `        <Iptc4xmpCore:CiAdrCity>${this.escapeXML(personalData.city)}</Iptc4xmpCore:CiAdrCity>\n`;
      }
      if (personalData.state) {
        xml += `        <Iptc4xmpCore:CiAdrRegion>${this.escapeXML(personalData.state)}</Iptc4xmpCore:CiAdrRegion>\n`;
      }
      if (personalData.postalCode) {
        xml += `        <Iptc4xmpCore:CiAdrPcode>${this.escapeXML(personalData.postalCode)}</Iptc4xmpCore:CiAdrPcode>\n`;
      }
      if (personalData.country) {
        xml += `        <Iptc4xmpCore:CiAdrCtry>${this.escapeXML(personalData.country)}</Iptc4xmpCore:CiAdrCtry>\n`;
      }
      if (personalData.phone) {
        xml += `        <Iptc4xmpCore:CiTelWork>${this.escapeXML(personalData.phone)}</Iptc4xmpCore:CiTelWork>\n`;
      }
      if (personalData.email) {
        xml += `        <Iptc4xmpCore:CiEmailWork>${this.escapeXML(personalData.email)}</Iptc4xmpCore:CiEmailWork>\n`;
      }
      if (personalData.website) {
        xml += `        <Iptc4xmpCore:CiUrlWork>${this.escapeXML(personalData.website)}</Iptc4xmpCore:CiUrlWork>\n`;
      }
      
      xml += `      </Iptc4xmpCore:CreatorContactInfo>\n`;
    }
    
    // Job Title
    if (personalData.jobTitle) {
      xml += `      <photoshop:AuthorsPosition>${this.escapeXML(personalData.jobTitle)}</photoshop:AuthorsPosition>\n`;
    }
    
    return xml;
  }

  /**
   * Format keywords as RDF list items
   */
  formatKeywords(keywords) {
    if (!keywords || keywords.length === 0) return '';
    
    return keywords
      .map(kw => `          <rdf:li>${this.escapeXML(kw)}</rdf:li>`)
      .join('\n');
  }

  /**
   * Format location fields
   */
  formatLocation(location) {
    if (!location) return '';
    
    let xml = '';
    
    if (location.city) {
      xml += `      <photoshop:City>${this.escapeXML(location.city)}</photoshop:City>\n`;
    }
    
    if (location.state) {
      xml += `      <photoshop:State>${this.escapeXML(location.state)}</photoshop:State>\n`;
    }
    
    if (location.country) {
      xml += `      <photoshop:Country>${this.escapeXML(location.country)}</photoshop:Country>\n`;
    }
    
    if (location.specificLocation) {
      xml += `      <Iptc4xmpCore:Location>${this.escapeXML(location.specificLocation)}</Iptc4xmpCore:Location>\n`;
    }
    
    return xml;
  }

  /**
   * Escape XML special characters
   */
  escapeXML(text) {
    if (typeof text !== 'string') return '';
    
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = XMPGenerator;
