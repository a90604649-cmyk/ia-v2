param(
    [int]$Port = 3030
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$script:SelectedImage = $null

$form = New-Object System.Windows.Forms.Form
$form.Text = "Roblox AI - Creador de VFX"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(700, 390)
$form.MinimumSize = New-Object System.Drawing.Size(600, 340)
$form.FormBorderStyle = "Sizable"
$form.MaximizeBox = $true
$form.MinimizeBox = $true

$title = New-Object System.Windows.Forms.Label
$title.Text = "Describe el efecto VFX que quieres crear"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(18, 15)
$form.Controls.Add($title)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Puedes adjuntar una imagen PNG, JPG o WEBP como referencia visual."
$hint.ForeColor = [System.Drawing.Color]::DimGray
$hint.AutoSize = $true
$hint.Location = New-Object System.Drawing.Point(20, 48)
$form.Controls.Add($hint)

$requestBox = New-Object System.Windows.Forms.TextBox
$requestBox.Multiline = $true
$requestBox.ScrollBars = "Vertical"
$requestBox.AcceptsReturn = $true
$requestBox.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$requestBox.Location = New-Object System.Drawing.Point(20, 78)
$requestBox.Size = New-Object System.Drawing.Size(644, 170)
$requestBox.Anchor = "Top,Bottom,Left,Right"
$form.Controls.Add($requestBox)

$attachImage = New-Object System.Windows.Forms.Button
$attachImage.Text = "Adjuntar imagen..."
$attachImage.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$attachImage.Size = New-Object System.Drawing.Size(145, 32)
$attachImage.Location = New-Object System.Drawing.Point(20, 255)
$attachImage.Anchor = "Bottom,Left"
$form.Controls.Add($attachImage)

$removeImage = New-Object System.Windows.Forms.Button
$removeImage.Text = "Quitar imagen"
$removeImage.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$removeImage.Size = New-Object System.Drawing.Size(115, 32)
$removeImage.Location = New-Object System.Drawing.Point(173, 255)
$removeImage.Anchor = "Bottom,Left"
$removeImage.Enabled = $false
$form.Controls.Add($removeImage)

$imagePathLabel = New-Object System.Windows.Forms.Label
$imagePathLabel.Text = "Ninguna imagen adjunta"
$imagePathLabel.ForeColor = [System.Drawing.Color]::DimGray
$imagePathLabel.AutoSize = $false
$imagePathLabel.Location = New-Object System.Drawing.Point(300, 263)
$imagePathLabel.Size = New-Object System.Drawing.Size(350, 20)
$imagePathLabel.Anchor = "Bottom,Left,Right"
$form.Controls.Add($imagePathLabel)

$attachImage.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Selecciona una imagen de referencia"
    $dialog.Filter = "Imágenes compatibles (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|Todos los archivos (*.*)|*.*"
    $dialog.FilterIndex = 1
    $dialog.Multiselect = $false
    $dialog.CheckFileExists = $true
    $dialog.RestoreDirectory = $true

    try {
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            $file = Get-Item -LiteralPath $dialog.FileName
            $extension = [System.IO.Path]::GetExtension($dialog.FileName).ToLowerInvariant()
            if ($extension -notin @(".png", ".jpg", ".jpeg", ".webp")) {
                [System.Windows.Forms.MessageBox]::Show(
                    "Selecciona un archivo PNG, JPG o WEBP.",
                    "Formato no compatible",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                ) | Out-Null
                return
            }
            if ($file.Length -gt 8MB) {
                [System.Windows.Forms.MessageBox]::Show(
                    "La imagen supera el límite de 8 MB. Elige una imagen más pequeña.",
                    "Imagen demasiado grande",
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Warning
                ) | Out-Null
                return
            }

            $script:SelectedImage = $dialog.FileName
            $imagePathLabel.Text = "Adjunta: " + [System.IO.Path]::GetFileName($script:SelectedImage)
            $imagePathLabel.ForeColor = [System.Drawing.Color]::DarkSlateBlue
            $removeImage.Enabled = $true
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            ("No se pudo abrir la imagen seleccionada." + [Environment]::NewLine + $_.Exception.Message),
            "Error al adjuntar",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    finally {
        $dialog.Dispose()
    }
})

$removeImage.Add_Click({
    $script:SelectedImage = $null
    $imagePathLabel.Text = "Ninguna imagen adjunta"
    $imagePathLabel.ForeColor = [System.Drawing.Color]::DimGray
    $removeImage.Enabled = $false
})

$send = New-Object System.Windows.Forms.Button
$send.Text = "Enviar"
$send.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$send.Size = New-Object System.Drawing.Size(110, 35)
$send.Location = New-Object System.Drawing.Point(554, 303)
$send.Anchor = "Bottom,Right"
$form.Controls.Add($send)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Listo. Los errores y logs aparecen en la consola del Bridge."
$status.ForeColor = [System.Drawing.Color]::DimGray
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(20, 313)
$status.Anchor = "Bottom,Left"
$form.Controls.Add($status)

function Send-Request {
    $message = $requestBox.Text.Trim()

    if ([string]::IsNullOrWhiteSpace($message) -and [string]::IsNullOrWhiteSpace($script:SelectedImage)) {
        $status.Text = "Escribe una petición o adjunta una imagen."
        $status.ForeColor = [System.Drawing.Color]::DarkOrange
        return
    }

    if ([string]::IsNullOrWhiteSpace($message) -and -not [string]::IsNullOrWhiteSpace($script:SelectedImage)) {
        $message = "Analiza la imagen adjunta como referencia visual y crea un efecto VFX profesional en Roblox Studio."
    }

    if (-not [string]::IsNullOrWhiteSpace($script:SelectedImage)) {
        $safePath = $script:SelectedImage.Replace('"', '')
        $message += [Environment]::NewLine + '@img: "' + $safePath + '"'
    }

    try {
        $json = @{ message = $message } | ConvertTo-Json -Compress
        $response = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/ask" -f $Port) -Method Post -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 10

        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
            $requestBox.Clear()
            $script:SelectedImage = $null
            $imagePathLabel.Text = "Ninguna imagen adjunta"
            $imagePathLabel.ForeColor = [System.Drawing.Color]::DimGray
            $removeImage.Enabled = $false
            $status.Text = "Petición enviada al Bridge."
            $status.ForeColor = [System.Drawing.Color]::ForestGreen
        } else {
            $status.Text = "El Bridge devolvió HTTP $($response.StatusCode)."
            $status.ForeColor = [System.Drawing.Color]::Firebrick
        }
    }
    catch {
        $status.Text = "No se pudo conectar con el Bridge."
        $status.ForeColor = [System.Drawing.Color]::Firebrick
        [System.Windows.Forms.MessageBox]::Show(
            ("No se pudo enviar la petición." + [Environment]::NewLine + $_.Exception.Message),
            "Roblox AI Bridge",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

$send.Add_Click({ Send-Request })
$form.AcceptButton = $send

$form.Add_Shown({
    $requestBox.Focus()
})

[void]$form.ShowDialog()
