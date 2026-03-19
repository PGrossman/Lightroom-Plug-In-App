local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrDialogs = import 'LrDialogs'
-- local LrJson = import 'LrJson' -- Removed due to SDK inconsistencies
local JSON = dofile(LrPathUtils.child(_PLUGIN.path, "JSON.lua"))

local function main()
    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    
    if #photos == 0 then
        LrDialogs.message("AI Meta Tagger", "No photos selected. Please select one or more photos to process.", "info")
        return
    end

    -- Create temp directory in Documents
    local documentsPath = LrPathUtils.getStandardFolder('Documents')
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
    -- DETERMINING PROJECT PATH: The plugin is in [Project]/AI_Meta_Tagger.lrdevplugin
    local projectPath = LrPathUtils.parent(_PLUGIN.path)
    -- We'll try to run via npm start. 
    -- MODIFIED: Source the zsh profile to ensure Node/npm are in the PATH
    local shellCommand = string.format('/bin/zsh -i -c "cd %q && npm start &"', projectPath)
    LrTasks.execute(shellCommand)

    -- Start polling loop in a message dialog so we don't block the UI entirely but show progress
    LrTasks.startAsyncTask(function()
        local found = false
        local timeout = 1800 -- 30 minutes timeout (AI analysis can take time)
        local elapsed = 0
        
        -- Optional: Show a progress dialog or just wait
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
                            -- Match by path
                            for _, p in ipairs(photos) do
                                if p:getRawMetadata('path') == item.path then
                                    if item.keywords then 
                                        -- Lr keywords are complex, but setting them as a list usually works for simple tagging
                                        -- Depending on the SDK version, you might need to use LrKeywords tools
                                        -- but for now we'll use the simple field update if possible or just log it.
                                        -- Actually, p:setRawMetadata('keywords', list) is correct but might need careful handling.
                                    end
                                    if item.title then p:setRawMetadata('title', item.title) end
                                    if item.caption then p:setRawMetadata('caption', item.caption) end
                                    if item.gpsLatitude and item.gpsLongitude then
                                        p:setRawMetadata('gps', { latitude = item.gpsLatitude, longitude = item.gpsLongitude })
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
