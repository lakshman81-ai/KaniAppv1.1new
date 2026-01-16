# Settings Sync with Google Sheets

## Overview
The Learning Galaxy app now supports automatic syncing of settings to a Google Sheet. This allows you to track and backup your app settings.

## Setup Instructions

### Step 1: Create a Google Apps Script
1. Go to https://script.google.com
2. Click "New Project"
3. Delete the default code and paste the following:

```javascript
function doPost(e) {
  try {
    // Get the active spreadsheet
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Parse the incoming data
    var data = JSON.parse(e.postData.contents);

    // If this is the first time, create headers
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Math Sheet URL', 'English Sheet URL', 'Default Difficulty', 'Sound Enabled']);
    }

    // Append the settings data as a new row
    sheet.appendRow([
      data.timestamp,
      data.mathSheetUrl,
      data.englishSheetUrl,
      data.defaultDifficulty,
      data.soundEnabled
    ]);

    return ContentService.createTextOutput(JSON.stringify({
      'status': 'success',
      'message': 'Settings saved successfully'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      'status': 'error',
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Save the project (File → Save) and name it "Learning Galaxy Settings Sync"

### Step 2: Create a Google Sheet
1. Go to https://sheets.google.com
2. Create a new blank spreadsheet
3. Name it "Learning Galaxy Settings"
4. Go back to your Apps Script project (from Step 1)
5. In the Apps Script editor, click on "Project Settings" (gear icon)
6. Copy the Script ID

### Step 3: Link the Script to the Sheet
1. In your Google Sheet, go to Extensions → Apps Script
2. This will open the script editor
3. Paste the code from Step 1 into the editor
4. Save the project

### Step 4: Deploy as Web App
1. In the Apps Script editor, click "Deploy" → "New deployment"
2. Click the gear icon next to "Select type" and choose "Web app"
3. Fill in the details:
   - Description: "Settings Sync"
   - Execute as: "Me"
   - Who has access: "Anyone" (or "Anyone with Google account" for more security)
4. Click "Deploy"
5. Copy the "Web app URL" - this is what you'll paste in the Learning Galaxy app

### Step 5: Configure in Learning Galaxy App
1. Open the Learning Galaxy app
2. Click the Settings (⚙️) icon
3. Scroll to "Settings Sync Sheet (Optional)"
4. Paste the Web App URL from Step 4
5. Click "Save"

## What Gets Saved
Every time you save settings in the app, the following data is sent to your Google Sheet:
- Timestamp (when the settings were saved)
- Math Sheet URL
- English Sheet URL
- Default Difficulty setting
- Sound Enabled status

## Privacy & Security
- The data is only sent to YOUR Google Sheet
- No data is sent to any third-party servers
- You control who has access to your Google Sheet
- The Settings Sync Sheet URL field is optional - leave it blank if you don't want to sync

## Troubleshooting
- **Settings not appearing in sheet**: Make sure the Web App is deployed with "Who has access" set to "Anyone"
- **Error messages**: Check that the Apps Script code is correct and the sheet is accessible
- **CORS errors**: This is normal - the app uses `mode: 'no-cors'` which means you won't see errors even if it fails. Check your Google Sheet to verify data was saved.
