# Lightroom Meta Tagger v0.6 - Prompt Strategy Quick Start

## 🎯 What's New in v0.6?

**DUAL PROMPT STRATEGY SYSTEM** - Choose between two proven AI analysis approaches:

### 1. **BALANCED** (Default, Recommended) ✅
- **Visual-first analysis** - AI focuses on what's actually IN the image
- **GPS validation** - Validates GPS coordinates against visual content
- **Subject detection** - Identifies primary subject with confidence score
- **Realistic confidence** - 60-90% typical (not inflated 95-100%)
- **Cleaner output** - No markdown blocks, faster parsing
- **36% shorter prompts** - Faster processing, lower API costs

### 2. **ORIGINAL** (v0.5 Legacy)
- **Context-heavy** - Prioritizes folder keywords and GPS data
- **Keyword-focused** - Extensive guidance for specific technical terms
- **Ban lists** - Explicit rules to avoid generic keywords
- **Domain-specific** - Special rules for aviation, architecture, etc.

---

## 🚀 How to Use

### Current Strategy (Check Log)
```javascript
// Check app.log for:
[INFO] Ollama analysis complete {
  confidence: 82,
  strategy: 'balanced'  // ← Current strategy
}
```

### Switch to Balanced (Recommended)
**Edit `config.json`:**
```json
{
  "aiAnalysis": {
    "promptStrategy": "balanced"
  }
}
```

### Switch to Original (Legacy)
**Edit `config.json`:**
```json
{
  "aiAnalysis": {
    "promptStrategy": "original"
  }
}
```

**Then restart the application.**

---

## 📊 Strategy Comparison

| Feature | Balanced | Original |
|---------|----------|----------|
| **Visual Priority** | ✅ Yes | ⚠️ Context-first |
| **GPS Validation** | ✅ With reasoning | ❌ No |
| **Subject Detection** | ✅ Confidence score | ❌ No |
| **Prompt Length** | 1,400 chars | 2,200 chars |
| **Keyword Guidance** | Moderate | Extensive |
| **Confidence Range** | 60-90% realistic | Often 95-100% |
| **Output Format** | Clean JSON | May have markdown |
| **Processing Speed** | ⚡ Faster | Slower |
| **Best For** | Visual analysis | Context-rich folders |

---

## 🎨 Example Outputs

### Image: F-18 Super Hornet Formation

#### Balanced Strategy Output:
```json
{
  "subjectDetection": {
    "subject": "Four F-18 Super Hornet fighter jets in delta formation",
    "confidence": 88
  },
  "keywords": [
    "F-18 Super Hornet",
    "Blue Angels",
    "US Navy",
    "delta formation",
    "afterburner",
    "smoke trails",
    "air show"
  ],
  "gpsAnalysis": {
    "validation": "AGREE",
    "validationReasoning": "Image shows open sky and ocean horizon consistent with coastal coordinates"
  },
  "confidence": 88
}
```

#### Original Strategy Output:
```json
{
  "keywords": [
    "F-18 Super Hornet",
    "Blue Angels",
    "precision",        // ← Generic/abstract
    "teamwork",         // ← Generic/abstract
    "military aviation",
    "formation flight",
    "excellence"        // ← Generic/abstract
  ],
  "confidence": 95      // ← Often inflated
}
```

---

## ✅ When to Use Each Strategy

### Use **BALANCED** when:
- ✅ Visual content is most important
- ✅ You have GPS coordinates to validate
- ✅ You want realistic confidence scores
- ✅ You need faster processing
- ✅ You want cleaner JSON output
- ✅ Subject identification is critical

### Use **ORIGINAL** when:
- ✅ Rich folder/GPS context available
- ✅ Domain-specific keywords needed (aviation, etc.)
- ✅ Extensive keyword guidance required
- ✅ You need backward compatibility
- ✅ Context should influence keywords heavily

---

## 🔧 Technical Details

### Files Modified:
- `src/services/aiAnalysisService.js` - Dual strategy implementation
- `config.json` - Added `promptStrategy` setting

### New Methods:
- `buildPrompt(context, strategy)` - Router method
- `buildPromptOriginal(context)` - v0.5 prompt
- `buildPromptBalanced(context)` - VLM Tester prompt

### Performance:
- **Balanced**: 1,400 chars → Faster API calls
- **Original**: 2,200 chars → More tokens

---

## 🐛 Troubleshooting

### Issue: AI returns markdown blocks
```json
```json
{ "title": "..." }
```
```

**Solution:** Switch to balanced strategy
```json
"promptStrategy": "balanced"
```

### Issue: Confidence always 95-100%

**Solution:** Switch to balanced strategy
```json
"promptStrategy": "balanced"
```

### Issue: No GPS validation in output

**Check:**
1. Using balanced strategy? ✅
2. Image has GPS coordinates? ✅
3. Look for `gpsAnalysis` field in response

### Issue: Keywords too generic

**Solution:** Try balanced strategy
```json
"promptStrategy": "balanced"
```

---

## 📦 Version Info

- **Version**: 0.6
- **Release Date**: October 13, 2025
- **Based On**: VLM Tester proven strategies
- **Backward Compatible**: ✅ Yes

---

## 📚 Documentation

- **Full Docs**: `z_VERSIONS/VERSION-0.6-PROMPT-STRATEGY.txt`
- **Quick Start**: This file
- **GitHub**: https://github.com/PGrossman/Lightroom-Meta-Tagger

---

## 🎉 Quick Tips

1. **Default to Balanced** - It's proven to work better in most cases
2. **Check Logs** - Always verify which strategy is being used
3. **Test Both** - Try both strategies on same images to compare
4. **Switch Anytime** - No data loss when switching strategies
5. **Restart Required** - After changing config, restart the app

---

**Recommendation: Start with BALANCED strategy for best results!** 🚀

