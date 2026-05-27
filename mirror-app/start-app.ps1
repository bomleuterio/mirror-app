$electronExePath = "c:\Users\Administrator\Documents\trae_projects\mirror App\mirror-app\node_modules\electron\dist\electron.exe"
$appRootPath = "c:\Users\Administrator\Documents\trae_projects\mirror App\mirror-app"

$quotedAppRootPath = '"' + $appRootPath + '"'

Start-Process -FilePath $electronExePath -WorkingDirectory $appRootPath -ArgumentList $quotedAppRootPath -NoNewWindow
