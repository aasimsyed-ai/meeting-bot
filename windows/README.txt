MEETING ASSISTANT ON WINDOWS
============================

Double-click files to install, open and remove the app. No administrator rights are needed:
the app installs for your Windows user only, like most apps from the web.

Status: the app is a working beta that has not yet been used in real meetings on a real
Windows laptop. These scripts are tested automatically on a Windows machine on every change
(install, find, open, uninstall), but not yet on your PC.

What is here
------------
  Install.cmd      Installs Meeting Assistant, or updates it to the newest version.
  Open.cmd         Opens the app, and shows where it, your notes and the log file are.
  Uninstall.cmd    Removes the app. Your meetings and notes are kept (see below).
  MeetingAssistant.ps1   The script the three files above run. You do not need to open it.

Install
-------
  1. Double-click Install.cmd.
     - If a file named Meeting-Assistant-Setup-<version>.exe is in this folder, it uses that.
     - Otherwise it downloads the newest published version from
       https://github.com/aasimsyed-ai/meeting-bot/releases and checks the download against
       the checksum published with it. If they do not match, it deletes the file and stops.
  2. The installer opens. Click through it (the defaults are fine).
  3. Open the app from the Start menu or the "Meeting Assistant" icon on your desktop.
     The first time, it asks to download its speech engine (about 515 MB, one time).

Where is it?
------------
  Double-click Open.cmd. It opens the app and prints where everything is. Normally:
    App:             %LOCALAPPDATA%\Programs\Meeting Assistant\Meeting Assistant.exe
    Notes and data:  %APPDATA%\Meeting Assistant
    Log file:        %APPDATA%\Meeting Assistant\logs\main.log
  (Paste one of these into the File Explorer address bar to go there.)
  The log never contains what was said in meetings. Send it if something goes wrong.

Uninstall
---------
  Double-click Uninstall.cmd and confirm. Your meetings, notes and settings stay in
  %APPDATA%\Meeting Assistant in case you install again. To remove them too, use
  Settings > Delete everything in the app before uninstalling, or delete that folder after.

Warnings you may see
--------------------
  * "Open File - Security Warning" when double-clicking a .cmd file from a downloaded ZIP:
    click Run. To avoid it, right-click the ZIP > Properties > tick "Unblock" > OK, then unzip.
  * "Windows protected your PC" when running a Setup file you downloaded in the browser:
    click "More info", then "Run anyway". The app is not code-signed yet (that needs a paid
    certificate and is planned for the public release). Nothing about it is faked as signed.

If something goes wrong
-----------------------
  * "No published version was found": download Meeting-Assistant-Setup-<version>.exe from
    the releases page above, put it in this folder, and double-click Install.cmd again.
  * Each script says what went wrong in plain words and changes nothing else.
  * Please tell people in the meeting that you are taking notes.
