local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrDialogs = import 'LrDialogs'
local JSON = dofile(LrPathUtils.child(_PLUGIN.path, "JSON.lua"))

local function main()
    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    
    if #photos == 0 then
        LrDialogs.message("AI Meta Tagger", "No photos selected. Please select one or more photos to process.", "info")
        return
    end

    -- Create temp directory in Documents
    local documentsPath = LrPathUtils.getStandardFilePath('documents')
    local tempPath = LrPathUtils.child(documentsPath, 'LR_AI_Temp')
    if not LrFileUtils.exists(tempPath) then
        LrFileUtils.createAllDirectories(tempPath)
    end

    local requestFile = LrPathUtils.child(tempPath, 'request.json')
    local responseFile = LrPathUtils.child(tempPath, 'response.json')

    -- Cleanup any stale files
    if LrFileUtils.exists(requestFile) then LrFileUtils.delete(requestFile) end
    if LrFileUtils.exists(responseFile) then LrFileUtils.delete(responseFile) end

    -- Gather photo data
    local requestData = { images = {} }
    for _, photo in ipairs(photos) do
        local path = photo:getRawMetadata('path')
        -- FIX: Correct SDK method for reading GPS
        local gps = photo:getRawMetadata('gps')
        local lat, lon = nil, nil
        if gps and type(gps) == 'table' then
            lat = gps.latitude
            lon = gps.longitude
        end
        
        table.insert(requestData.images, {
            path = path,
            gpsLatitude = lat,
            gpsLongitude = lon
        })
    end

    -- Write request.json
    local jsonString = JSON.encode(requestData)
    local f = io.open(requestFile, "w")
    if f then
        f:write(jsonString)
        f:close()
    else
        LrDialogs.message("AI Meta Tagger Error", "Could not write request.json to " .. requestFile, "error")
        return
    end

    -- Launch Electron App
    local projectPath = LrPathUtils.parent(_PLUGIN.path)
    
    -- Force macOS to include standard Node/npm installation paths
    -- Use %s with single quotes to safely handle folder paths with spaces
    local shellCommand = string.format('export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && cd \'%s\' && npm start &', projectPath)
    
    -- Use os.execute instead of LrTasks for reliable detached background execution
    os.execute(shellCommand)

    -- Start polling loop
    LrTasks.startAsyncTask(function()
        local found = false
        local timeout = 1800 -- 30 minutes timeout
        local elapsed = 0
        
        while not found and elapsed < timeout do
            if LrFileUtils.exists(responseFile) then
                found = true
            else
                elapsed = elapsed + 5
                LrTasks.sleep(5)
            end
        end

        if found then
            -- Read response.json
            local resF = io.open(responseFile, "r")
            if resF then
                local resJson = resF:read("*all")
                resF:close()
                local responseData = JSON.decode(resJson)
                
                if responseData and responseData.images then
                    -- Apply metadata with write access
                    catalog:withWriteAccessDo("Apply AI Metadata", function()
                        for _, item in ipairs(responseData.images) do
                            for _, p in ipairs(photos) do
                                if p:getRawMetadata('path') == item.path then
                                    
                                    -- FIX: Actually create and apply the keywords!
                                    if item.keywords and type(item.keywords) == "table" then
                                        for _, kwStr in ipairs(item.keywords) do
                                            -- createKeyword(name, synonyms, includeOnExport, parent, returnExisting)
                                            local kwObj = catalog:createKeyword(kwStr, {}, true, nil, true)
                                            p:addKeyword(kwObj)
                                        end
                                    end
                                    
                                    if item.title then p:setRawMetadata('title', item.title) end
                                    if item.caption then p:setRawMetadata('caption', item.caption) end
                                    
                                    -- FIX: Correct SDK method for writing GPS
                                    if item.gpsLatitude and item.gpsLongitude then
                                        p:setRawMetadata('gps', { 
                                            latitude = tonumber(item.gpsLatitude), 
                                            longitude = tonumber(item.gpsLongitude) 
                                        })
                                    end
                                    
                                    break
                                end
                            end
                        end
                    end)
                    
                    -- Cleanup
                    LrFileUtils.delete(requestFile)
                    LrFileUtils.delete(responseFile)
                    LrDialogs.message("AI Meta Tagger", "Processing complete! Metadata has been applied back to Lightroom.", "info")
                else
                    LrDialogs.message("AI Meta Tagger", "Received empty or invalid response from AI app.", "warning")
                end
            end
        else
            LrDialogs.message("AI Meta Tagger Timeout", "Timed out waiting for the AI app. Please check if it's still running.", "error")
        end
    end)
end

-- Run in task to avoid blocking
LrTasks.startAsyncTask(main)
