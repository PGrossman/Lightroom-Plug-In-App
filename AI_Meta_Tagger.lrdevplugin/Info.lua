-- Info.lua for AI Meta Tagger Lightroom Plugin
return {
	LrSdkVersion = 11.0,
	LrSdkMinimumVersion = 10.0,
	LrAppIdentifier = 'com.antigravity.aimetatagger',
	LrPluginName = 'AI Meta Tagger',
	LrToolkitIdentifier = 'com.adobe.lightroom.sdk',

	LrExportMenuItems = {
		{
			title = "Process Selected Photos with AI",
			file = "ProcessImages.lua",
		},
	},

	LrLibraryMenuItems = {
		{
			title = "Process Selected Photos with AI",
			file = "ProcessImages.lua",
		},
	},
}
