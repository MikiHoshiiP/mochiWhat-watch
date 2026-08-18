# Mercari Watch 桌面通知 toast
# 参数通过环境变量传递,避免引号转义问题:
#   TOAST_TITLE / TOAST_MESSAGE
$title = $env:TOAST_TITLE
$message = $env:TOAST_MESSAGE

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName("text")
$texts.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
$texts.Item(1).AppendChild($template.CreateTextNode($message)) | Out-Null

$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Mercari Watch")
$notifier.Show($toast)
