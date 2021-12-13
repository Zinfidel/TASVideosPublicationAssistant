# TASVideos Publication Assistant
A tool for automating some steps in the TASVideos publication process.

![image](https://user-images.githubusercontent.com/1929934/145865073-940f894a-ce0a-4b29-a89c-6cb93bda9067.png)

## Summary
The tool handles uploading of encodes to archive.org and creating torrents for the encodes. Many details for both of these processes are automatically determined rather than needing to be copied-and-pasted.

## The Log
Click the scroll icon in the program's title bar to get a log displaying useful information about operations the tool is performing.

## Common
This section hosts fields that are shared amongst the other sections of the tool.

**Email and Password**: These are required for uploading to archive.org, and just the email is required for searching archive.org. Click the 'Save' button to save these fields to the Windows Credential Manager.

**Encode Files**: These are the files that get uploaded to archive.org and/or by the torrent-creation tool. Dragging the files (at the same time or individually) on to the square labeled 'Drop' will automatically place the paths in the textboxes. The "..." buttons can be clicked for a file-picker dialog.

## Upload
This section of the tool helps with uploading encodes to archive.org. The email, password, and both encode fields in the Common section need to be filled out.

**Page ID**: This must be checked to be unique before uploading. It is automatically filled out based on file names. Click the 'Check' button to query archive.org as to whether the ID is available. If it is not, the field will automatically change to a new ID as suggested by archive.org.

**Description**: This field is for the submission link, and the link + details about the submission can be automatically retrieved. Just enter the submission number into the field (i.e. 1234) and click the 'Get' button. The description field will be turned into a link, and the Creator and Date fields will automatically be filled out.

**Subject Tags**: Up to 10, comma-separated tags can be entered. Click the 'Save' button to save a common list of tags between sessions.

**Upload**: Upon clicking the 'Upload' button, if there are invalid fields that are required for the process, they will be highlighted. Open the log for this operation to see detailed information about its progress. When it is done, the page will usually become available in less than a minute. You can check the availability by periodically clicking the 'Search' button in the Video section until the new page shows up.

## Video
This section searches archive.org for your most recent uploads, and automatically pulls the links to the modern and compatability encodes from those pages.

**Search**: This button will search archive.org for the 5 most recent uploads made by the email entered in the Common section.

**Encode URLs**: The tool will automatically find the modern and compatability links for use in torrent-making and publication. Click the clipboard button next to a textbox to copy the link.

## Torrent
This section automatically creates torrents for encodes.

**Torrent Files**: These fields are automatically filled out based on the location of the files in the Common section (torrents are created next to them).

**Build Torrents**: Upon clicking the 'Build Torrents' button, torrents will be created from the files in the Common section, and the URLs in the Video section. Make sure to select the correct archive.org page in the Video section before creating the torrents!
