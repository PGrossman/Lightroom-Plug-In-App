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
    local shellCommand = string.format('export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && cd "%s" && npm start &', projectPath)
    
    -- We MUST use LrTasks.execute because os.execute is sandboxed
    LrTasks.execute(shellCommand)

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
                                    
                                    -- 1. Apply Keywords safely
                                    if item.keywords and type(item.keywords) == "table" then
                                        for _, kwStr in ipairs(item.keywords) do
                                            if type(kwStr) == "string" and kwStr ~= "" then
                                                -- Strip commas and pipes which cause LR assertions
                                                local safeKw = kwStr:gsub("[,|]", ""):gsub("^%s*(.-)%s*$", "%1")
                                                if safeKw ~= "" then
                                                    pcall(function()
                                                        -- Pass nil instead of {} for synonyms to prevent asserts
                                                        local kwObj = catalog:createKeyword(safeKw, nil, true, nil, true)
                                                        if kwObj then
                                                            p:addKeyword(kwObj)
                                                        end
                                                    end)
                                                end
                                            end
                                        end
                                    end
                                    
                                    -- 2. Apply Title safely
                                    if type(item.title) == "string" and item.title ~= "" then 
                                        pcall(function() p:setRawMetadata('title', item.title) end)
                                    end
                                    
                                    -- 3. Apply Caption safely
                                    if type(item.caption) == "string" and item.caption ~= "" then 
                                        pcall(function() p:setRawMetadata('caption', item.caption) end)
                                    end
                                    
                                    -- 4. Apply GPS safely
                                    local lat = tonumber(item.gpsLatitude)
                                    local lon = tonumber(item.gpsLongitude)
                                    if lat and lon then
                                        pcall(function()
                                            p:setRawMetadata('gps', { latitude = lat, longitude = lon })
                                        end)
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
