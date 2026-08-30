# 🚀 LitRPG Release Watch - Fresh Installation Guide

## 📦 What's Included

This package contains the **complete, fixed extension** with all bug fixes:

### ✅ All Bug Fixes Applied:
1. **Permissions Fix** - manifest.json has `tabs` and `scripting` in regular permissions
2. **Pollution Max Fix** - Max calculated only from known authors
3. **Re-Extraction Fix** - Uses existing bookNumber from items
4. **Manual Check Notifications** - Manual checks now send notifications
5. **Hybrid Detection** - Number-based + ASIN-based for all series
6. **"Title 3" Pattern** - Extracts numbers from formats like "Skill Eater 3"

### 📁 Package Contents:
```
litrpg-release-watch/
├── manifest.json (fixed)
├── background.js (fixed)
├── diff.js (fixed)
├── scraper.js (fixed)
├── utils.js (fixed)
├── content.js
├── export.js
├── notifications.js
├── options.js
├── popup.js
├── statistics.js
├── storage.js
├── types.js
├── options.html
├── options.css
├── popup.html
├── popup.css
├── assets/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── parsers/
    ├── audible.js
    └── amazon.js
```

---

## 🔧 Installation Steps

### Step 1: Backup Your Data

**IMPORTANT:** Export your series list first!

1. Open your current extension
2. Go to **Options page**
3. Scroll to bottom
4. Click **"Export Data"** button
5. Save the JSON file to your Downloads folder

**This is your backup!** Keep it safe.

---

### Step 2: Uninstall Old Extension

1. Go to `brave://extensions/`
2. Find "LitRPG Release Watch"
3. Click **"Remove"**
4. Confirm removal
5. **Close Brave completely** (quit, not just close tabs)

---

### Step 3: Extract & Install New Extension

1. **Extract the zip file** to a permanent location
   - Example: `C:\Users\YourName\Documents\Extensions\litrpg-release-watch`
   - **IMPORTANT:** Don't extract to Downloads or Temp folders!
   
2. **Reopen Brave**

3. Go to `brave://extensions/`

4. **Enable "Developer mode"** (toggle in top right)

5. Click **"Load unpacked"**

6. **Select the extracted folder** (the one containing manifest.json)

7. Extension should appear in your extensions list ✅

---

### Step 4: Restore Your Data

1. Click the extension icon → Click **gear icon** (Options)

2. Scroll to bottom

3. Click **"Import Data"** button

4. Select the JSON backup file from Step 1

5. Your series list is restored! ✅

---

### Step 5: Clear Old Snapshots (CRITICAL!)

**Open background console:**
1. `brave://extensions/`
2. Find "LitRPG Release Watch"
3. Click **"Inspect views: background page"**
4. In the console tab, paste:

```javascript
chrome.storage.local.get(['series', 'settings']).then(async function(d) {
  await chrome.storage.local.set({
    series: d.series,
    settings: d.settings,
    snapshots: {},
    updates: [],
    lastCheck: {}
  });
  console.log('✅ Snapshots cleared - ready for fresh start!');
});
```

**Why?** Old snapshots have wrong data. Fresh start needed.

---

### Step 6: Rebuild Snapshots

**Option A: Automatic (Recommended)**
- Wait for next automated check (runs every 12 hours)
- All 45 series will be checked automatically
- Go about your day!

**Option B: Manual (Faster)**
1. Go to Options page
2. Scroll to bottom
3. Click **"Check All Series"** button
4. Wait 5-10 minutes
5. All series checked!

---

### Step 7: Verify Everything Works

**In background console:**

```javascript
chrome.storage.local.get(['snapshots', 'series']).then(function(d) {
  let numberMode = 0;
  let asinMode = 0;
  
  Object.values(d.snapshots).forEach(function(snap) {
    const maxNum = Math.max(...snap.items.map(i => i.bookNumber || 0));
    if (maxNum > 0) numberMode++; else asinMode++;
  });
  
  console.log('=== SYSTEM STATUS ===');
  console.log('NUMBER-based tracking:', numberMode, 'series');
  console.log('ASIN-based tracking:', asinMode, 'series');
  console.log('Total:', numberMode + asinMode, 'series');
  console.log('\n✅ Hybrid detection system active!');
});
```

**Expected:**
```
NUMBER-based tracking: ~25 series
ASIN-based tracking: ~20 series
Total: 45 series
✅ Hybrid detection system active!
```

---

## 🧪 Test Notifications

Create a test alert:

```javascript
chrome.storage.local.get(['snapshots', 'series']).then(async function(d) {
  // Pick any series
  const testSeries = Object.values(d.series)[0];
  const snapKey = testSeries.id + '_audible';
  const realSnap = d.snapshots[snapKey];
  
  if (!realSnap) {
    console.log('⏳ Wait for snapshots to rebuild first');
    return;
  }
  
  // Create fake old snapshot (missing one book)
  const fakeOldSnap = {
    ...realSnap,
    items: realSnap.items.slice(1), // Remove first book
    timestamp: Date.now() - (7 * 24 * 60 * 60 * 1000)
  };
  
  d.snapshots[snapKey] = fakeOldSnap;
  await chrome.storage.local.set({ snapshots: d.snapshots, updates: [] });
  
  console.log('✅ Test ready!');
  console.log('Go to Options → Find "' + testSeries.title + '" → Click refresh');
  console.log('You should get a notification!');
});
```

**Then:**
1. Go to Options page
2. Find the series mentioned in console
3. Click refresh button (🔄)
4. **Notification should pop up!** 🎉

---

## ⚙️ Settings to Check

**In Options page:**

### Notifications
- ✅ **System notifications enabled** (you want this ON)
- ⚠️ **Quiet hours** (optional - set times when you don't want notifications)

### Checking
- **Check interval:** Every 12 hours (automated)
- **Ignore preorders:** Your preference (ON = only notify when available)

---

## 🎯 What to Expect

### Automated Checks
- **Runs:** Every 12 hours (alarm)
- **What it does:**
  - Checks all 45 series
  - Detects new releases (both numbered and unnumbered series)
  - Sends notifications for new books
  - Updates badge with unread count

### Manual Checks
- **When:** You click refresh in Options page
- **What it does:**
  - Checks that specific series
  - Detects new releases
  - **NOW SENDS NOTIFICATIONS!** (fixed!)
  - Updates badge

### Detection Modes
- **25 series:** NUMBER-based (high confidence, low false positives)
- **20 series:** ASIN-based (medium confidence, catches all releases)

---

## 🐛 Troubleshooting

### "No snapshots" or "Total: 0 series"
→ Wait for snapshots to rebuild (automated check or click "Check All Series")

### Notifications not appearing
→ Check `brave://settings/content/notifications` - allow notifications

### "Permission denied" errors
→ Extension should ask for permissions on install. If not, reinstall.

### Badge shows number but no notification
→ This is normal if you just installed. Next NEW release will notify.

### Some series showing max=0
→ Those series use ASIN-based detection (no book numbers in titles)

---

## ✅ Success Checklist

After installation and setup:

- [ ] Extension installed and appears in extensions list
- [ ] Data imported (series list restored)
- [ ] Snapshots cleared (ran clear script)
- [ ] Snapshots rebuilding (check running)
- [ ] Hybrid detection active (~25 NUMBER, ~20 ASIN)
- [ ] Test notification worked
- [ ] Badge updating correctly
- [ ] Automated alarm set (runs every 12 hours)

---

## 🎉 You're All Set!

The extension will now:
- ✅ Automatically check every 12 hours
- ✅ Track all 45 series (including those without book numbers!)
- ✅ Send notifications for new releases
- ✅ Update badge with unread count
- ✅ Handle cross-series pollution correctly
- ✅ Extract book numbers from all formats (including "Book Five", "Skill Eater 3", etc.)

**No more missed releases!** 🚀📚

---

## 📞 Need Help?

If something doesn't work:
1. Check background console for errors (`brave://extensions/` → "Inspect views")
2. Verify permissions are granted
3. Make sure snapshots have been rebuilt
4. Test manually with a single series first

**Enjoy your fully-fixed LitRPG tracker!** 🎉
