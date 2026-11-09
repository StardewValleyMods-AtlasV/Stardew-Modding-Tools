# Stardew Valley modding tools

A small suite of browser tools. The index page (`index.html`) lists each tool. Some of these tools may exist in other formats, however there are times where I need versions that can run on any device and so browser tools are the best alternative for me. 

The current tools are:

- **Content unpacker** (`tools/content-unpacker/`): a static web page that takes a zip of the Stardew Valley `Content` folder in zip format, unpacks every `.xnb` file in your browser, and gives you back a `Content (unpacked).zip`.

## Content unpacker: how it works

- `tools/content-unpacker/js/app.js` is the page UI.
- `tools/content-unpacker/js/worker.js` reads the zip with JSZip, then sends each `.xnb` to a pool of `xnbWorker.js` workers (up to 4) and writes the results into the output zip.
- `decode.js` calls xnb.js (`bufferToXnb` and `xnbDataToFiles`) with the Stardew Valley 1.6 readers.
- `libs/` is the xnb.js bundle copied unmodified from `docs/js/libs` in [lybell-art/xnb-js](https://github.com/lybell-art/xnb-js). `vendor/jszip.min.js` is JSZip 3.10.1.

The top-level folder in your zip (normally `Content/`) becomes `Content (unpacked)/` in the output. Files that fail to unpack are skipped and listed in `_unpack-errors.txt` in the output zip and on the page.

Things to know

- **Memory.** JSZip loads the whole input zip into memory, so a zip over roughly 2 GB will fail, and copying non .xnb files (the audio banks) raises memory use a lot. Leave that option off unless you need them.
- **Maps** come out as `.tbin`, not `.tmx`.
- **Browser support** needs module workers (current Chrome, Edge, Firefox, Safari).

## Licenses

-xnb.js is LGPL-3.0-or-later
-JSZip is MIT/GPLv3
-Open Sans (Latin subset, converted to WOFF, in `fonts/`) is SIL Open Font License 1.1. Its copyright line and license are in `fonts/OFL.txt` and must stay with the font files.
Their license texts are in `licenses/`.
