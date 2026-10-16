local HttpService = game:GetService("HttpService")

-- Modo de diagnóstico: solo advertencias/errores; se silencian los print rutinarios.
local warnOriginal = warn
local function valorLogDiagnostico(valor)
	if type(valor) == "table" then
		local okJson, json = pcall(function()
			return HttpService:JSONEncode(valor)
		end)
		if okJson then
			return json
		end
	end
	return tostring(valor)
end

local function warnConDiagnostico(...)
	local partes = {}
	for indice = 1, select("#", ...) do
		table.insert(partes, valorLogDiagnostico(select(indice, ...)))
	end

	local traza = ""
	local okTraza, resultadoTraza = pcall(function()
		return debug.traceback("", 3)
	end)
	if okTraza and type(resultadoTraza) == "string" then
		local lineas = {}
		for linea in string.gmatch(resultadoTraza, "[^\n]+") do
			table.insert(lineas, linea)
			if #lineas >= 6 then
				break
			end
		end
		traza = table.concat(lineas, "\n")
	end

	warnOriginal("[Roblox AI][DIAGNOSTIC_WARN] " .. table.concat(partes, " ") .. (traza ~= "" and ("\n" .. traza) or ""))
end

local warn = warnConDiagnostico
local print = function(...) end
local AssetService = game:GetService("AssetService")
local InsertService = game:GetService("InsertService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local StudioTestService = game:GetService("StudioTestService")
local LogService = game:GetService("LogService")

local BASE_URL = "http://127.0.0.1:3000"
local NEXT_URL = BASE_URL .. "/next"
local HEALTH_URL = BASE_URL .. "/health"
local PROJECT_SCAN_URL = "http://127.0.0.1:3001/project-scan"
local TEST_RESULTS_URL = BASE_URL .. "/test-results"
local EXECUTION_RESULTS_URL = BASE_URL .. "/execution-results"
local TEXTURE_CATALOG_URL = BASE_URL .. "/texture-catalog"
local TEXTURE_VALIDATION_URL = BASE_URL .. "/texture-validation"
local MODEL_VALIDATION_URL = BASE_URL .. "/model-validation"
local VISUAL_CAPTURE_URL = BASE_URL .. "/visual-capture"

local INTERVALO_ESCANEO = 300
local CAPTURA_ANCHO_MAX = 256
local MAX_ESPERA_CAPTURA = 12
local MAX_SOURCE_CHARS = 340000
local MAX_BATCH_CHARS = 700000
local MAX_SCRIPTS_PER_BATCH = 25
local MAX_OBJECTS = 1500

local toolbar = plugin:CreateToolbar("Roblox AI")
local button = toolbar:CreateButton(
	"Roblox AI",
	"Crear y refinar efectos visuales con la IA de VFX",
	""
)
button.ClickableWhenViewportHidden = true

-- Señal única de carga: si no aparece, Studio no está ejecutando este archivo actualizado.
warnOriginal("[Roblox AI][DIAGNOSTIC] Plugin cargado; botón de VFX registrado.")

local conectado = false
local consultando = false
local escaneando = false
local ultimoEscaneo = 0

-- Declaradas mas abajo, despues de las validaciones de textura.
local recolectarTexturas
local enviarCatalogoTexturas

local SERVICIOS = {
	ReplicatedStorage = game:GetService("ReplicatedStorage"),
	StarterGui = game:GetService("StarterGui"),
	Workspace = workspace,
	Lighting = game:GetService("Lighting")
}

local VFX_ROOTS = {
	Workspace = true,
	ReplicatedStorage = true,
	Lighting = true,
	StarterGui = true
}

local VFX_INSTANCE_CLASSES = {
	Folder = true,
	Model = true,
	Part = true,
	MeshPart = true,
	WedgePart = true,
	CornerWedgePart = true,
	Attachment = true,
	ParticleEmitter = true,
	Beam = true,
	Trail = true,
	PointLight = true,
	SpotLight = true,
	SurfaceLight = true,
	Highlight = true,
	Texture = true,
	Decal = true,
	SpecialMesh = true,
	BlockMesh = true,
	CylinderMesh = true,
	Fire = true,
	Smoke = true,
	Sparkles = true,
	BillboardGui = true,
	SurfaceGui = true,
	Frame = true,
	ImageLabel = true,
	ImageButton = true,
	UIGradient = true,
	UICorner = true
}

local VFX_ACTION_TYPES = {
	create_instance = true,
	set_property = true,
	set_properties = true,
	rename_instance = true,
	move_instance = true,
	delete_instance = true,
	verify_textures = true,
	verify_models = true,
	insertar_modelo = true
}

local function raizVFXPermitida(ruta)
	if type(ruta) ~= "string" or ruta == "" then
		return false
	end
	local normalizada = ruta:gsub("\\", "/")
	local raiz = string.match(normalizada, "^([^/]+)")
	return VFX_ROOTS[raiz] == true
end

local SCRIPT_TYPES = {
	create_script = "Script",
	create_local_script = "LocalScript",
	create_module_script = "ModuleScript",
	update_script = "Script",
	update_local_script = "LocalScript",
	update_module_script = "ModuleScript",
	delete_script = "Script",
	delete_local_script = "LocalScript",
	delete_module_script = "ModuleScript"
}

local REMOTE_TYPES = {
	create_remote_event = "RemoteEvent",
	create_remote_function = "RemoteFunction",
	delete_remote_event = "RemoteEvent",
	delete_remote_function = "RemoteFunction"
}

local function debeIgnorar(objeto)
	local nombre = string.lower(objeto.Name or "")
	local ruta = string.lower(objeto:GetFullName() or "")

	return nombre == "robloxaibridgeplugin"
		or string.find(nombre, "geminibridgeplugin", 1, true) ~= nil
		or string.find(ruta, "geminibridgeplugin", 1, true) ~= nil
		or string.find(ruta, "roblox ai bridge", 1, true) ~= nil
		or string.find(ruta, "projectcontext", 1, true) ~= nil
end

local function obtenerContenedor(ruta, crearCarpetas)
	if type(ruta) ~= "string" or ruta == "" or string.find(ruta, "..", 1, true) then
		return nil
	end

	local partes = string.split(ruta:gsub("\\", "/"), "/")
	local actual = SERVICIOS[partes[1]]
	if not actual then
		return nil
	end

	for i = 2, #partes do
		local nombre = partes[i]
		if nombre ~= "" then
			local siguiente = actual:FindFirstChild(nombre)
			if not siguiente then
				if not crearCarpetas then
					return nil
				end
				siguiente = Instance.new("Folder")
				siguiente.Name = nombre
				siguiente.Parent = actual
			end
			actual = siguiente
		end
	end

	return actual
end

local function obtenerInstancia(ruta, nombre)
	local contenedor = obtenerContenedor(ruta, false)
	if not contenedor or type(nombre) ~= "string" or nombre == "" then
		return nil
	end
	return contenedor:FindFirstChild(nombre)
end

local function obtenerRutaDesdeRaiz(objeto, raiz, nombreRaiz)
	local partes = {}
	local actual = objeto

	while actual and actual ~= raiz do
		table.insert(partes, 1, actual.Name)
		actual = actual.Parent
	end

	if actual ~= raiz then
		return nil
	end

	table.insert(partes, 1, nombreRaiz)
	return table.concat(partes, "/")
end

local function obtenerRuta(objeto)
	local padre = objeto.Parent
	if not padre then
		return nil
	end

	for nombreRaiz, raiz in pairs(SERVICIOS) do
		local ruta = obtenerRutaDesdeRaiz(padre, raiz, nombreRaiz)
		if ruta then
			return ruta
		end
	end

	return nil
end

local function obtenerSource(objeto)
	local ok, source = pcall(function()
		return ScriptEditorService:GetEditorSource(objeto)
	end)

	if ok and type(source) == "string" then
		return source
	end

	local okFallback, fallback = pcall(function()
		return objeto.Source
	end)

	if okFallback and type(fallback) == "string" then
		return fallback
	end

	return nil
end

local function actualizarSource(objeto, source)
	if type(source) ~= "string" then
		return false
	end

	local ok, err = pcall(function()
		ScriptEditorService:UpdateSourceAsync(objeto, function()
			return source
		end)
	end)

	if ok then
		return true
	end

	local okFallback, fallbackError = pcall(function()
		objeto.Source = source
	end)

	if not okFallback then
		warn("[Roblox AI] No se pudo actualizar Source:", err or fallbackError)
		return false
	end

	return true
end

local function recolectarScripts()
	local resultado = {}

	for _, raiz in pairs(SERVICIOS) do
		for _, objeto in ipairs(raiz:GetDescendants()) do
			if not debeIgnorar(objeto)
				and (objeto:IsA("Script") or objeto:IsA("LocalScript") or objeto:IsA("ModuleScript")) then

				local ruta = obtenerRuta(objeto)
				local source = obtenerSource(objeto)

				if ruta and source and #source <= MAX_SOURCE_CHARS then
					table.insert(resultado, {
						className = objeto.ClassName,
						name = objeto.Name,
						path = ruta,
						source = source
					})
				end
			end
		end
	end

	table.sort(resultado, function(a, b)
		return (a.path .. "/" .. a.name) < (b.path .. "/" .. b.name)
	end)

	return resultado
end

-- Que propiedades describen la APARIENCIA de cada clase.
-- Es conocimiento general de Roblox (que propiedad dibuja que), no una receta de un efecto concreto.
local PROPIEDADES_VISUALES = {
	BasePart = {"Size", "Color", "Transparency", "Material", "Anchored", "Shape", "CanCollide"},
	Decal = {"Texture", "Face", "Color3", "Transparency", "ZIndex"},
	Texture = {"Texture", "Face", "Color3", "Transparency", "StudsPerTileU", "StudsPerTileV"},
	ParticleEmitter = {"Texture", "Color", "Size", "Transparency", "Rate", "Speed", "Lifetime", "LightEmission", "LightInfluence", "Rotation", "EmissionDirection", "Acceleration"},
	PointLight = {"Color", "Brightness", "Range", "Shadows"},
	SpotLight = {"Color", "Brightness", "Range", "Angle", "Face"},
	SurfaceLight = {"Color", "Brightness", "Range", "Angle", "Face"},
	Beam = {"Color", "Texture", "Width0", "Width1", "Segments", "FaceCamera"},
	Trail = {"Color", "Texture", "WidthScale", "Lifetime", "FaceCamera"},
	Fire = {"Color", "SecondaryColor", "Size", "Heat"},
	Smoke = {"Color", "Size", "Opacity", "RiseVelocity"},
	Sparkles = {"Color", "SparkleColor", "TimeScale"},
	SpecialMesh = {"MeshType", "Scale", "Offset", "TextureId"},
	BlockMesh = {"Scale", "Offset"},
	CylinderMesh = {"Scale", "Offset"},
	Highlight = {"FillColor", "OutlineColor", "FillTransparency", "OutlineTransparency"},
	Attachment = {"Position"},
	BillboardGui = {"Size", "StudsOffset", "AlwaysOnTop"},
	SurfaceGui = {"Face", "LightInfluence", "AlwaysOnTop"},
	ImageLabel = {"Image", "ImageColor3", "ImageTransparency"},
	ImageButton = {"Image", "ImageColor3", "ImageTransparency"},
	UIGradient = {"Color", "Rotation", "Transparency"}
}

local function formatearPropiedad(valor)
	local tipo = typeof(valor)
	if tipo == "Vector3" then
		return string.format("%.2f,%.2f,%.2f", valor.X, valor.Y, valor.Z)
	elseif tipo == "Vector2" then
		return string.format("%.2f,%.2f", valor.X, valor.Y)
	elseif tipo == "Color3" then
		return string.format(
			"#%02X%02X%02X",
			math.floor(valor.R * 255 + 0.5),
			math.floor(valor.G * 255 + 0.5),
			math.floor(valor.B * 255 + 0.5)
		)
	elseif tipo == "UDim2" then
		return string.format(
			"%.3f,%.1f,%.3f,%.1f",
			valor.X.Scale, valor.X.Offset, valor.Y.Scale, valor.Y.Offset
		)
	elseif tipo == "NumberRange" then
		return string.format("%.2f..%.2f", valor.Min, valor.Max)
	elseif tipo == "CFrame" then
		local p = valor.Position
		return string.format("%.2f,%.2f,%.2f", p.X, p.Y, p.Z)
	elseif tipo == "number" then
		return string.format("%.3f", valor)
	elseif tipo == "boolean" or tipo == "EnumItem" then
		return tostring(valor)
	elseif tipo == "string" then
		if #valor > 140 then
			return string.sub(valor, 1, 140) .. "..."
		end
		return valor
	elseif tipo == "NumberSequence" then
		local minimo, maximo
		for _, punto in ipairs(valor.Keypoints) do
			local v = punto.Value
			minimo = minimo and math.min(minimo, v) or v
			maximo = maximo and math.max(maximo, v) or v
		end
		return string.format("%d keypoints %.2f..%.2f", #valor.Keypoints, minimo or 0, maximo or 0)
	elseif tipo == "ColorSequence" then
		return string.format("%d keypoints", #valor.Keypoints)
	end
	return nil
end

-- Devuelve una descripcion textual de COMO SE VE la instancia (no de como se llama).
local function describirEstructura(objeto)
	local nombres = PROPIEDADES_VISUALES[objeto.ClassName]
	if not nombres and objeto:IsA("BasePart") then
		nombres = PROPIEDADES_VISUALES.BasePart
	end
	if not nombres then
		return nil
	end

	local partes = {}
	for _, nombre in ipairs(nombres) do
		local ok, valor = pcall(function()
			return objeto[nombre]
		end)
		if ok and valor ~= nil then
			local texto = formatearPropiedad(valor)
			if texto and texto ~= "" then
				table.insert(partes, nombre .. "=" .. texto)
			end
		end
	end

	if #partes == 0 then
		return nil
	end

	local descripcion = table.concat(partes, " ")
	if #descripcion > 420 then
		descripcion = string.sub(descripcion, 1, 420)
	end
	return descripcion
end

local function recolectarObjetos()
	local resultado = {}

	for _, raiz in pairs(SERVICIOS) do
		for _, objeto in ipairs(raiz:GetDescendants()) do
			if #resultado >= MAX_OBJECTS then
				break
			end

			if not debeIgnorar(objeto) and VFX_INSTANCE_CLASSES[objeto.ClassName] then
				local ruta = obtenerRuta(objeto)
				if ruta and raizVFXPermitida(ruta) then
					table.insert(resultado, {
						className = objeto.ClassName,
						name = objeto.Name,
						path = ruta,
						estructura = describirEstructura(objeto)
					})
				end
			end
		end
	end

	table.sort(resultado, function(a, b)
		return (a.path .. "/" .. a.name) < (b.path .. "/" .. b.name)
	end)

	return resultado
end

local function dividirLotes(scripts)
	local lotes = {}
	local actual = {}
	local caracteres = 0

	for _, scriptData in ipairs(scripts) do
		local costo = #scriptData.source + #scriptData.path + #scriptData.name + 150
		local superaTamano = #actual > 0 and caracteres + costo > MAX_BATCH_CHARS
		local superaCantidad = #actual >= MAX_SCRIPTS_PER_BATCH

		if superaTamano or superaCantidad then
			table.insert(lotes, actual)
			actual = {}
			caracteres = 0
		end

		table.insert(actual, scriptData)
		caracteres += costo
	end

	if #actual > 0 then
		table.insert(lotes, actual)
	end

	return lotes
end

local function enviarEscaneo(scripts, objects, reset)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = PROJECT_SCAN_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				reset = reset == true,
				scripts = scripts,
				objects = objects or {}
			})
		})
	end)

	if not ok or not response.Success then
		warn("[Roblox AI] Error enviando contexto:", ok and response.Body or response)
		return false
	end

	return true
end

local function escanearProyecto()
	if escaneando or not conectado then
		return false
	end

	escaneando = true

	-- En modo VFX solo se comparte metadata de instancias visuales; nunca código fuente de scripts.
	local scripts = {}
	local objects = recolectarObjetos()
	local lotes = dividirLotes(scripts)
	local correcto = true

	if #lotes == 0 then
		correcto = enviarEscaneo({}, objects, true)
	else
		for indice, lote in ipairs(lotes) do
			if not enviarEscaneo(lote, indice == 1 and objects or {}, indice == 1) then
				correcto = false
				break
			end
			task.wait(0.05)
		end
	end

	if correcto then
		ultimoEscaneo = os.clock()
		print("[Roblox AI] ✅ Contexto actualizado:", #scripts, "scripts |", #objects, "objetos detectados")
		enviarCatalogoTexturas()
	end

	escaneando = false
	return correcto
end

local function comprobarServidor()
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = HEALTH_URL,
			Method = "GET"
		})
	end)

	if not ok or not response.Success then
		warn("[Roblox AI] No se pudo conectar al servidor:", ok and response.Body or response)
		return false
	end

	local jsonOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)

	if not jsonOk or type(data) ~= "table" or data.ok ~= true then
		warn("[Roblox AI] /health devolvio datos invalidos.")
		return false
	end

	print("[Roblox AI] ✅ OmniRoute:", tostring(data.model))
	return true
end

local function convertirValor(valor)
	if type(valor) ~= "table" then
		return valor
	end

	local tipo = tostring(valor.type or "")

	if tipo == "Vector2" then
		return Vector2.new(tonumber(valor.x) or 0, tonumber(valor.y) or 0)
	elseif tipo == "Vector3" then
		return Vector3.new(tonumber(valor.x) or 0, tonumber(valor.y) or 0, tonumber(valor.z) or 0)
	elseif tipo == "Color3" then
		return Color3.new(
			math.clamp(tonumber(valor.r) or 0, 0, 1),
			math.clamp(tonumber(valor.g) or 0, 0, 1),
			math.clamp(tonumber(valor.b) or 0, 0, 1)
		)
	elseif tipo == "CFrame" then
		return CFrame.new(
			tonumber(valor.x) or 0,
			tonumber(valor.y) or 0,
			tonumber(valor.z) or 0
		) * CFrame.Angles(
			math.rad(tonumber(valor.rx) or 0),
			math.rad(tonumber(valor.ry) or 0),
			math.rad(tonumber(valor.rz) or 0)
		)
	elseif tipo == "UDim2" then
		return UDim2.new(
			tonumber(valor.xScale) or 0,
			tonumber(valor.xOffset) or 0,
			tonumber(valor.yScale) or 0,
			tonumber(valor.yOffset) or 0
		)
	elseif tipo == "BrickColor" then
		return BrickColor.new(tostring(valor.value or "Medium stone grey"))
	elseif tipo == "NumberRange" then
		local minimum = tonumber(valor.min) or tonumber(valor.minimum) or 0
		local maximum = tonumber(valor.max) or tonumber(valor.maximum) or minimum
		return NumberRange.new(math.min(minimum, maximum), math.max(minimum, maximum))
	elseif tipo == "NumberSequence" then
		if type(valor.keypoints) ~= "table" or #valor.keypoints < 2 then
			error("NumberSequence requiere al menos 2 keypoints.")
		end

		local keypoints = {}
		local previousTime = -1
		for _, point in ipairs(valor.keypoints) do
			local time = tonumber(point.time)
			local value = tonumber(point.value)
			local envelope = tonumber(point.envelope) or 0
			if not time or not value or time < 0 or time > 1 or time < previousTime then
				error("Keypoints de NumberSequence inválidos o desordenados.")
			end
			table.insert(keypoints, NumberSequenceKeypoint.new(time, value, math.max(0, envelope)))
			previousTime = time
		end
		if keypoints[1].Time ~= 0 or keypoints[#keypoints].Time ~= 1 then
			error("NumberSequence debe empezar en tiempo 0 y terminar en tiempo 1.")
		end
		return NumberSequence.new(keypoints)
	elseif tipo == "ColorSequence" then
		if type(valor.keypoints) ~= "table" or #valor.keypoints < 2 then
			error("ColorSequence requiere al menos 2 keypoints.")
		end

		local keypoints = {}
		local previousTime = -1
		for _, point in ipairs(valor.keypoints) do
			local time = tonumber(point.time)
			local colorData = point.color or point
			local color = convertirValor({
				type = "Color3",
				r = colorData.r,
				g = colorData.g,
				b = colorData.b
			})
			if not time or time < 0 or time > 1 or time < previousTime then
				error("Keypoints de ColorSequence inválidos o desordenados.")
			end
			table.insert(keypoints, ColorSequenceKeypoint.new(time, color))
			previousTime = time
		end
		if keypoints[1].Time ~= 0 or keypoints[#keypoints].Time ~= 1 then
			error("ColorSequence debe empezar en tiempo 0 y terminar en tiempo 1.")
		end
		return ColorSequence.new(keypoints)
	elseif tipo == "Enum" then
		local nombreEnum = tostring(valor.enum or "")
		-- EmissionDirection es un NormalId, no un enum propio: el modelo suele inventarse el nombre.
		if nombreEnum == "EmissionDirection" then
			nombreEnum = "NormalId"
		end

		local enumObjeto = Enum[nombreEnum]
		if enumObjeto then
			local enumItem = enumObjeto[tostring(valor.value or "")]
			if enumItem then
				return enumItem
			end
		end
		error("Enum inválido: " .. tostring(valor.enum) .. "." .. tostring(valor.value))
	end

	return valor
end

local function propiedadPermitida(nombre)
	if type(nombre) ~= "string" or nombre == "" then
		return false
	end

	return nombre ~= "Parent"
		and nombre ~= "ClassName"
		and nombre ~= "Source"
		and nombre ~= "Archivable"
end

local function aplicarPropiedad(objeto, nombre, valor)
	if not objeto or not propiedadPermitida(nombre) then
		return false
	end

	local convertido
	local ok, err = pcall(function()
		convertido = convertirValor(valor)
		objeto[nombre] = convertido
	end)

	if not ok then
		warn("[Roblox AI] No se pudo cambiar", objeto:GetFullName(), nombre, err)
		return false
	end

	print("[Roblox AI] ⚙ PROPIEDAD:", objeto:GetFullName(), nombre, "=", tostring(convertido))
	return true
end

local function aplicarPropiedades(objeto, propiedades)
	if type(propiedades) ~= "table" then
		return 0
	end

	local total = 0
	for nombre, valor in pairs(propiedades) do
		if aplicarPropiedad(objeto, tostring(nombre), valor) then
			total += 1
		end
	end

	return total
end

local function claseCoincide(objeto, className)
	return not className or className == "" or objeto.ClassName == className
end

local function ejecutarScriptAction(action)
	local tipo = SCRIPT_TYPES[action.type]
	if not tipo then
		return false
	end

	local path = tostring(action.path or "")
	local name = tostring(action.name or "")
	local esCreate = action.type:sub(1, 7) == "create_"
	local esDelete = action.type:sub(1, 7) == "delete_"
	local container = obtenerContenedor(path, esCreate)

	if not container or name == "" then
		warn("[Roblox AI] Ruta invalida:", path, name)
		return false
	end

	local existing = container:FindFirstChild(name)

	if esCreate then
		if existing then
			warn("[Roblox AI] CREATE rechazado: ya existe", existing:GetFullName())
			return false
		end

		if type(action.code) ~= "string" or action.code == "" then
			warn("[Roblox AI] CREATE sin SOURCE completo:", path .. "/" .. name)
			return false
		end

		local ok, created = pcall(function()
			local instance = Instance.new(tipo)
			instance.Name = name
			instance.Parent = container
			return instance
		end)

		if not ok or not created then
			warn("[Roblox AI] No se pudo crear", tipo, created)
			return false
		end

		if not actualizarSource(created, action.code) then
			created:Destroy()
			return false
		end

		if created:IsA("Script") or created:IsA("LocalScript") then
			created.Enabled = true
		end

		print("[Roblox AI] ✅ CREADO:", created:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear " .. name)
		return true
	end

	if not existing or existing.ClassName ~= tipo then
		warn("[Roblox AI] Objeto de script no encontrado:", path .. "/" .. name)
		return false
	end

	if action.type:sub(1, 7) == "update_" then
		if type(action.code) ~= "string" or action.code == "" then
			warn("[Roblox AI] UPDATE sin SOURCE completo:", path .. "/" .. name)
			return false
		end

		if not actualizarSource(existing, action.code) then
			return false
		end

		if existing:IsA("Script") or existing:IsA("LocalScript") then
			existing.Enabled = true
		end

		print("[Roblox AI] ✏ ACTUALIZADO:", existing:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute actualizar " .. name)
		return true
	end

	if esDelete then
		local fullName = existing:GetFullName()
		existing:Destroy()
		print("[Roblox AI] 🗑 ELIMINADO:", fullName)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. name)
		return true
	end

	return false
end

local function ejecutarRemoteAction(action)
	local className = REMOTE_TYPES[action.type]
	if not className then
		return false
	end

	local path = tostring(action.path or "")
	local name = tostring(action.name or "")
	local container = obtenerContenedor(path, action.type:sub(1, 7) == "create_")
	if not container or name == "" then
		return false
	end

	local existing = container:FindFirstChild(name)

	if action.type:sub(1, 7) == "create_" then
		if existing then
			return existing.ClassName == className
		end

		local ok, created = pcall(function()
			local instance = Instance.new(className)
			instance.Name = name
			instance.Parent = container
			return instance
		end)

		if not ok then
			warn("[Roblox AI] No se pudo crear remote:", created)
			return false
		end

		print("[Roblox AI] ✅ REMOTE CREADO:", created:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear remote " .. name)
		return true
	end

	if not existing or existing.ClassName ~= className then
		return false
	end

	existing:Destroy()
	print("[Roblox AI] 🗑 REMOTE ELIMINADO:", path .. "/" .. name)
	ChangeHistoryService:SetWaypoint("OmniRoute eliminar remote " .. name)
	return true
end

local function ejecutarCarpeta(action)
	local path = tostring(action.path or "")
	local name = tostring(action.name or "")

	if name == "" or string.find(name, "/", 1, true) or string.find(name, "\\", 1, true) then
		return false
	end

	if action.type == "create_folder" then
		local container = obtenerContenedor(path, true)
		if not container then return false end
		if container:FindFirstChild(name) then return true end

		local folder = Instance.new("Folder")
		folder.Name = name
		folder.Parent = container
		print("[Roblox AI] ✅ CARPETA CREADA:", folder:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute crear carpeta " .. name)
		return true
	end

	if action.type == "delete_folder" then
		local container = obtenerContenedor(path, false)
		if not container then return false end

		local folder = container:FindFirstChild(name)
		if not folder or not folder:IsA("Folder") then return false end

		folder:Destroy()
		print("[Roblox AI] 🗑 CARPETA ELIMINADA:", path .. "/" .. name)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar carpeta " .. name)
		return true
	end

	return false
end

-- ============================================================
-- VALIDACION VISUAL: texturas y jerarquia
-- ============================================================

local ContentProvider = game:GetService("ContentProvider")

-- Estas clases solo emiten si cuelgan de una BasePart o un Attachment.
local CLASES_EMISORAS = {
	ParticleEmitter = true,
	Beam = true,
	Trail = true,
	Fire = true,
	Smoke = true,
	Sparkles = true
}

-- Estas luces solo iluminan si cuelgan de una BasePart o un Attachment.
local CLASES_LUZ = {
	PointLight = true,
	SpotLight = true,
	SurfaceLight = true
}

-- Clase -> propiedad que guarda su textura o imagen.
local PROPIEDAD_TEXTURA = {
	ParticleEmitter = "Texture",
	Beam = "Texture",
	Trail = "Texture",
	Decal = "Texture",
	Texture = "Texture",
	ImageLabel = "Image",
	ImageButton = "Image"
}

-- Sin textura, estas clases no dibujan absolutamente nada.
local TEXTURA_OBLIGATORIA = {
	ParticleEmitter = true
}

local TEXTURAS_SEGURAS = "rbxasset://textures/particles/fire_main.dds, rbxasset://textures/particles/smoke_main.dds o rbxasset://textures/particles/sparkles_main.dds"

local cacheTexturas = {}

local function texturaCarga(id)
	if type(id) ~= "string" or id == "" then
		return false
	end

	local cacheado = cacheTexturas[id]
	if cacheado ~= nil then
		return cacheado
	end

	local sonda = Instance.new("Decal")
	sonda.Texture = id

	local estado = "sin respuesta"
	local ok = pcall(function()
		ContentProvider:PreloadAsync({sonda}, function(_, status)
			estado = tostring(status)
		end)
	end)

	sonda:Destroy()

	local valida = ok and estado == "Enum.AssetFetchStatus.Success"
	cacheTexturas[id] = valida

	if not valida then
		warn("[Roblox AI] Textura que no carga:", id, "->", estado)
	end

	return valida
end

local function texturaPermitida(className, propiedad, valor)
	local esperada = PROPIEDAD_TEXTURA[className]
	if not esperada or propiedad ~= esperada then
		return true
	end

	local convertido = convertirValor(valor)

	if type(convertido) ~= "string" or convertido == "" then
		if TEXTURA_OBLIGATORIA[className] then
			warn("[Roblox AI] RECHAZADO: " .. className .. " sin " .. esperada .. " no dibuja nada. Usa " .. TEXTURAS_SEGURAS)
			return false
		end
		return true
	end

	if not texturaCarga(convertido) then
		warn("[Roblox AI] RECHAZADO: la textura no existe o no carga:", convertido)
		warn("[Roblox AI] Usa una textura real de ReplicatedStorage/VFXTextures, una que ya exista en el proyecto, o " .. TEXTURAS_SEGURAS)
		return false
	end

	return true
end

-- Sin scripts que disparen Emit(), un emisor con Rate 0 nunca emite nada.
local function ratePermitido(className, propiedad, valor)
	if className ~= "ParticleEmitter" or propiedad ~= "Rate" or valor == nil then
		return true
	end

	local convertido = tonumber(convertirValor(valor))

	if convertido and convertido <= 0 then
		warn("[Roblox AI] RECHAZADO: ParticleEmitter con Rate = 0 nunca emite y el VFX queda invisible. Pon un Rate mayor que 0.")
		return false
	end

	return true
end

local function propiedadesVisualesValidas(className, propiedades)
	if type(propiedades) ~= "table" then
		return true
	end

	if not ratePermitido(className, "Rate", propiedades.Rate) then
		return false
	end

	local esperada = PROPIEDAD_TEXTURA[className]
	if not esperada then
		return true
	end

	local valor = propiedades[esperada]

	if valor == nil then
		if TEXTURA_OBLIGATORIA[className] then
			warn("[Roblox AI] RECHAZADO: create_instance de " .. className .. " sin " .. esperada .. ". Usa " .. TEXTURAS_SEGURAS)
			return false
		end
		return true
	end

	return texturaPermitida(className, esperada, valor)
end

local function padreVisualValido(className, padre)
	if not (CLASES_EMISORAS[className] or CLASES_LUZ[className]) then
		return true
	end

	if padre and (padre:IsA("BasePart") or padre:IsA("Attachment")) then
		return true
	end

	warn("[Roblox AI] RECHAZADO: " .. className .. " debe ser hijo directo de una BasePart o un Attachment. Dentro de " ..
		(padre and ("un " .. padre.ClassName) or "ese contenedor") .. " no emite ni ilumina.")

	return false
end

-- ============================================================
-- CATALOGO DE TEXTURAS: descubre las texturas que ya existen en el proyecto
-- ============================================================

local CLASES_CON_TEXTURA = {
	ParticleEmitter = "Texture",
	Beam = "Texture",
	Trail = "Texture",
	Decal = "Texture",
	Texture = "Texture",
	ImageLabel = "Image",
	ImageButton = "Image"
}

-- "rbxassetid://123" o "123" -> "rbxassetid://123". Si no es un id, devuelve nil.
local function idTexturaNormalizado(valor)
	if type(valor) ~= "string" then
		return nil
	end

	local limpio = string.match(valor, "rbxassetid://(%d+)") or string.match(valor, "^%s*(%d+)%s*$")
	if not limpio then
		return nil
	end

	return "rbxassetid://" .. limpio
end

recolectarTexturas = function()
	local vistas = {}
	local catalogo = {}

	local function agregar(instancia, valor, categoriaPorDefecto)
		local id = idTexturaNormalizado(valor)
		if not id or vistas[id] then
			return
		end
		vistas[id] = true

		local categoria = categoriaPorDefecto
		local actual = instancia.Parent
		while actual and not actual:IsA("DataModel") do
			if actual:IsA("Folder") or actual:IsA("Model") then
				categoria = actual.Name
				break
			end
			actual = actual.Parent
		end

		table.insert(catalogo, {
			id = id,
			categoria = categoria or "General",
			origen = instancia:GetFullName()
		})
	end

	for nombreRaiz in pairs(VFX_ROOTS) do
		local raiz = SERVICIOS[nombreRaiz]
		if raiz then
			for _, descendiente in ipairs(raiz:GetDescendants()) do
				local propiedad = CLASES_CON_TEXTURA[descendiente.ClassName]
				if propiedad then
					local ok, valor = pcall(function()
						return descendiente[propiedad]
					end)
					if ok then
						agregar(descendiente, valor, "Proyecto")
					end
				end
			end
		end
	end

	table.sort(catalogo, function(a, b)
		if a.categoria == b.categoria then
			return a.id < b.id
		end
		return a.categoria < b.categoria
	end)

	return catalogo
end

enviarCatalogoTexturas = function()
	local catalogo = recolectarTexturas()

	-- Una textura que ya falló al cargar en esta sesión no se ofrece al modelo:
	-- el bridge la rechazaría y el emisor entero se perdería.
	local utiles = {}
	for _, entrada in ipairs(catalogo) do
		local numerico = string.match(entrada.id, "(%d+)$")
		local muerta = cacheTexturas[entrada.id] == false
			or (numerico ~= nil and cacheTexturas[numerico] == false)
		if not muerta then
			table.insert(utiles, entrada)
		end
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = TEXTURE_CATALOG_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				textures = utiles,
				total = #utiles
			})
		})
	end)

	if not ok or not response.Success then
		warn("[Roblox AI] No se pudo enviar el catálogo de texturas:", ok and response.Body or response)
		return false
	end

	if #catalogo - #utiles > 0 then
		warn("[Roblox AI] Excluidas del catálogo " .. (#catalogo - #utiles) .. " textura(s) que no cargan en Studio")
	end

	print("[Roblox AI] 🎨 Catálogo de texturas enviado:", #utiles, "texturas")
	return true
end

local function ejecutarVerificacionTexturas(action)
	local entradas = action.textures or action.ids
	if type(entradas) ~= "table" then
		warn("[Roblox AI] verify_textures sin lista de texturas.")
		return false
	end

	local conocidas = {}
	for _, entrada in ipairs(recolectarTexturas()) do
		conocidas[entrada.id] = true
	end

	local orden = {}
	local categoriaDe = {}
	local estadoDe = {}
	local sondas = {}

	for _, entrada in ipairs(entradas) do
		local bruto
		local categoria = ""

		if type(entrada) == "string" then
			bruto = entrada
		elseif type(entrada) == "table" then
			bruto = entrada.id or entrada.texture
			categoria = tostring(entrada.categoria or entrada.category or "")
		end

		local id = idTexturaNormalizado(bruto)
		if not id and type(bruto) == "string" and bruto ~= "" then
			id = bruto
		end

		if id and estadoDe[id] == nil then
			local cacheado = cacheTexturas[id]
			if cacheado == nil then
				estadoDe[id] = "sin respuesta"
			elseif cacheado then
				estadoDe[id] = "Enum.AssetFetchStatus.Success"
			else
				estadoDe[id] = "Enum.AssetFetchStatus.Failure"
			end

			categoriaDe[id] = categoria
			table.insert(orden, id)
		end
	end

	local pendientes = {}
	for _, id in ipairs(orden) do
		if estadoDe[id] == "sin respuesta" then
			table.insert(pendientes, id)
		end
	end

	if #pendientes > 0 then
		local carpeta = Instance.new("Folder")
		carpeta.Name = "RobloxAIBridgePluginSondas"
		carpeta.Parent = workspace

		local placa = Instance.new("Part")
		placa.Name = "SondaTexturas"
		placa.Anchored = true
		placa.CanCollide = false
		placa.CanQuery = false
		placa.CanTouch = false
		placa.Transparency = 1
		placa.Size = Vector3.new(1, 1, 1)
		placa.CFrame = CFrame.new(0, 5000, 0)
		placa.Parent = carpeta

		for indice, id in ipairs(pendientes) do
			local sonda = Instance.new("Decal")
			sonda.Name = "Sonda" .. tostring(indice)
			sonda.Texture = id
			sonda.Parent = placa
			sondas[id] = sonda
		end

		-- Una sola tanda: sondear textura por textura era demasiado lento
		-- y el servidor se rendía antes de recibir el resultado.
		local okPreload = pcall(function()
			ContentProvider:PreloadAsync({placa}, function(contenido, status)
				local clave = idTexturaNormalizado(contenido)
				if clave and estadoDe[clave] == "sin respuesta" then
					estadoDe[clave] = tostring(status)
				end
			end)
		end)

		if not okPreload then
			warn("[Roblox AI] PreloadAsync en tanda falló; quedan texturas sin verificar.")
		end

		-- Red de seguridad: si la tanda no identificó alguna textura, se sondea sola.
		local restantes = 0
		for _, id in ipairs(pendientes) do
			if estadoDe[id] == "sin respuesta" and restantes < 6 then
				restantes += 1
				local estado = "sin respuesta"
				pcall(function()
					ContentProvider:PreloadAsync({sondas[id]}, function(_, status)
						estado = tostring(status)
					end)
				end)
				estadoDe[id] = estado
			end
		end

		carpeta:Destroy()
	end

	local resultados = {}
	for _, id in ipairs(orden) do
		local estado = estadoDe[id] or "sin respuesta"
		local valida = estado == "Enum.AssetFetchStatus.Success"
		cacheTexturas[id] = valida
		if not valida then
			warn("[Roblox AI] Textura que no carga:", id, "->", estado)
		end
		table.insert(resultados, {
			id = id,
			categoria = categoriaDe[id] or "",
			carga = valida,
			existeEnProyecto = conocidas[id] == true
		})
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = TEXTURE_VALIDATION_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				requestId = tostring(action.requestId or action.request_id or ""),
				results = resultados,
				total = #resultados
			})
		})
	end)

	if not ok or not response.Success then
		warn("[Roblox AI] No se pudo informar la validación de texturas:", ok and response.Body or response)
		return false
	end

	print("[Roblox AI] 🔎 Texturas verificadas:", #resultados)
	return true
end

local function cargarModeloCatalogo(assetId)
	local intentos = {
		function()
			return AssetService:LoadAssetAsync(assetId)
		end,
		function()
			return InsertService:LoadAsset(assetId)
		end
	}

	if type(game.GetObjects) == "function" then
		table.insert(intentos, function()
			local objetos = game:GetObjects("rbxassetid://" .. tostring(assetId))
			return objetos and objetos[1] or nil
		end)
	end

	local ultimoError = "sin detalle"
	for _, intento in ipairs(intentos) do
		local ok, resultado = pcall(intento)
		if ok and resultado then
			return resultado
		end
		ultimoError = tostring(resultado)
	end

	warn("[Roblox AI] No se pudo cargar el modelo del catálogo. Para assets públicos de terceros, comprueba Studio > Experience Settings > Security > Allow Loading Third Party Assets. No se marcará como válido sin cargarlo. Detalle:", ultimoError)
	return nil
end

-- Verifica que los candidatos pueden cargarse en Studio y contienen geometría/instancias visuales.
-- Los assets solo se cargan para inspección y se destruyen sin insertarlos en el proyecto.
local function ejecutarVerificacionModelos(action)
	local entradas = action.models
	if type(entradas) ~= "table" then
		warn("[Roblox AI] verify_models sin lista de modelos.")
		return false
	end

	local resultados = {}
	for indice, entrada in ipairs(entradas) do
		if indice > 6 then break end
		local id = type(entrada) == "table" and tostring(entrada.id or "") or tostring(entrada)
		local nombre = type(entrada) == "table" and tostring(entrada.nombre or "") or ""
		local validado, partes, emisores = false, 0, 0
		if string.match(id, "^%d+$") then
			local modelo = cargarModeloCatalogo(tonumber(id))
			if modelo then
				local inseguro = false
				local function inspeccionar(instancia)
					if instancia:IsA("Script") or instancia:IsA("LocalScript") or instancia:IsA("ModuleScript")
						or instancia:IsA("RemoteEvent") or instancia:IsA("RemoteFunction") then
						inseguro = true
					elseif instancia:IsA("BasePart") then
						partes += 1
					elseif instancia:IsA("ParticleEmitter") or instancia:IsA("Beam") or instancia:IsA("Trail")
						or instancia:IsA("Light") or instancia:IsA("Decal") or instancia:IsA("Texture") then
						emisores += 1
					end
				end
				inspeccionar(modelo)
				for _, descendiente in ipairs(modelo:GetDescendants()) do
					inspeccionar(descendiente)
				end
				validado = not inseguro and (partes > 0 or emisores > 0)
				modelo:Destroy()
			end
		end
		table.insert(resultados, {
			id = id,
			nombre = nombre,
			validado = validado,
			partes = partes,
			emisores = emisores
		})
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = MODEL_VALIDATION_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				requestId = tostring(action.requestId or action.request_id or ""),
				results = resultados,
				total = #resultados
			})
		})
	end)
	if not ok or not response.Success then
		warn("[Roblox AI] No se pudo informar la validación de modelos:", ok and response.Body or response)
		return false
	end
	print("[Roblox AI] Modelos del catálogo comprobados en Studio:", #resultados)
	return true
end

--[[
	* Inserta un modelo del catálogo público de Roblox. El assetId lo decide el
	* bridge (viene de la búsqueda), nunca el modelo de IA.
]]
local function ejecutarInsercionModelo(action)
	local assetId = tostring(action.assetId or action.id or ""):gsub("%s", "")
	if string.find(assetId, "^%d+$") == nil then
		warn("[Roblox AI] Inserción rechazada: assetId no numérico:", assetId)
		return false
	end

	local nombre = tostring(action.nombre or "")
	if string.find(nombre, "[\\/]") then
		warn("[Roblox AI] Inserción rechazada: nombre con separadores de ruta:", nombre)
		return false
	end

	local ruta = tostring(action.path or "")
	if ruta == "" then
		ruta = "Workspace/VFXCatalogo"
	end

	if not raizVFXPermitida(ruta) then
		warn("[Roblox AI] Ruta rechazada para insertar modelo:", ruta)
		return false
	end

	local contenedor = obtenerContenedor(ruta, true)
	if not contenedor then
		return false
	end

	local modelo = cargarModeloCatalogo(tonumber(assetId))
	if not modelo then
		warn("[Roblox AI] No se pudo cargar el asset del catálogo:", assetId)
		return false
	end

	local partes = 0
	local emisores = 0
	local inseguro = false

	local function inspeccionar(instancia)
		if instancia:IsA("Script") or instancia:IsA("LocalScript") or instancia:IsA("ModuleScript")
			or instancia:IsA("RemoteEvent") or instancia:IsA("RemoteFunction") then
			inseguro = true
		elseif instancia:IsA("BasePart") then
			partes += 1
		elseif instancia:IsA("ParticleEmitter") or instancia:IsA("Beam") or instancia:IsA("Trail")
			or instancia:IsA("Light") or instancia:IsA("Decal") or instancia:IsA("Texture") then
			emisores += 1
		end
	end

	inspeccionar(modelo)
	for _, descendiente in ipairs(modelo:GetDescendants()) do
		inspeccionar(descendiente)
	end

	if inseguro or (partes == 0 and emisores == 0) then
		modelo:Destroy()
		warn("[Roblox AI] Modelo del catálogo sin contenido visual verificable o con scripts/remotes, no se insertó:", assetId)
		return false
	end

	if nombre ~= "" then
		modelo.Name = nombre
	end

	modelo.Parent = contenedor
	ChangeHistoryService:SetWaypoint("OmniRoute insertar modelo " .. assetId)
	print(
		"[Roblox AI] MODELO DEL CATALOGO INSERTADO:",
		modelo:GetFullName(),
		"(partes:",
		partes,
		"emisores:",
		emisores,
		")"
	)
	return true
end

local function ejecutarExtendedAction(action)
	local tipo = string.lower(tostring(action.type or ""))
	if not VFX_ACTION_TYPES[tipo] then
		warn("[Roblox AI] Acción rechazada: el plugin solo ejecuta operaciones VFX.")
		return false
	end

	if tipo == "verify_textures" then
		return ejecutarVerificacionTexturas(action)
	end

	if tipo == "verify_models" then
		return ejecutarVerificacionModelos(action)
	end

	if tipo == "insertar_modelo" then
		return ejecutarInsercionModelo(action)
	end

	local path = tostring(action.path or "")
	local name = tostring(action.name or "")
	if not raizVFXPermitida(path) then
		warn("[Roblox AI] Ruta rechazada fuera de los contenedores VFX permitidos:", path)
		return false
	end

	if tipo == "create_instance" then
		local className = tostring(action.className or "")
		if not VFX_INSTANCE_CLASSES[className] or name == "" then
			warn("[Roblox AI] Clase rechazada: no pertenece a la lista visual VFX:", className)
			return false
		end

		local container = obtenerContenedor(path, true)
		if not container then return false end

		if not padreVisualValido(className, container) then
			return false
		end

		if not propiedadesVisualesValidas(className, action.properties) then
			return false
		end

		local existing = container:FindFirstChild(name)
		if existing then
			if not claseCoincide(existing, className) then
				warn("[Roblox AI] CREATE_INSTANCE rechazado: nombre ocupado por otra clase.")
				return false
			end
			local total = aplicarPropiedades(existing, action.properties)
			print("[Roblox AI] ℹ INSTANCIA YA EXISTE:", existing:GetFullName(), "propiedades:", total)
			return true
		end

		local ok, created = pcall(function()
			local instance = Instance.new(className)
			instance.Name = name
			instance.Parent = container
			return instance
		end)

		if not ok or not created then
			warn("[Roblox AI] No se pudo crear clase:", className, created)
			return false
		end

		local total = aplicarPropiedades(created, action.properties)
		print("[Roblox AI] ✅ INSTANCIA CREADA:", created:GetFullName(), "(" .. className .. ")", "propiedades:", total)
		ChangeHistoryService:SetWaypoint("OmniRoute crear instancia " .. name)
		return true
	end

	local object = obtenerInstancia(path, name)
	if not object then
		warn("[Roblox AI] Objeto no encontrado:", path .. "/" .. name)
		return false
	end

	if not VFX_INSTANCE_CLASSES[object.ClassName] then
		warn("[Roblox AI] Objeto rechazado: no es un objeto visual VFX:", object:GetFullName())
		return false
	end

	if not claseCoincide(object, action.className) then
		warn("[Roblox AI] ClassName no coincide:", object:GetFullName(), object.ClassName, action.className)
		return false
	end

	if tipo == "set_property" then
		local propiedad = tostring(action.property or "")

		if not texturaPermitida(object.ClassName, propiedad, action.value) then
			return false
		end

		if not ratePermitido(object.ClassName, propiedad, action.value) then
			return false
		end

		local ok = aplicarPropiedad(object, propiedad, action.value)
		if ok then ChangeHistoryService:SetWaypoint("OmniRoute propiedad " .. name) end
		return ok
	end

	if tipo == "set_properties" then
		if not propiedadesVisualesValidas(object.ClassName, action.properties) then
			return false
		end

		local total = aplicarPropiedades(object, action.properties)
		if total > 0 then ChangeHistoryService:SetWaypoint("OmniRoute propiedades " .. name) end
		return total > 0
	end

	if tipo == "rename_instance" then
		local newName = tostring(action.newName or "")
		if newName == "" or string.find(newName, "/", 1, true) or string.find(newName, "\\", 1, true) then
			return false
		end

		local parent = object.Parent
		if not parent or parent:FindFirstChild(newName) then
			warn("[Roblox AI] RENOMBRAR rechazado: nombre ocupado.")
			return false
		end

		local oldName = object:GetFullName()
		object.Name = newName
		print("[Roblox AI] ✏ RENOMBRADO:", oldName, "→", object:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute renombrar " .. newName)
		return true
	end

	if tipo == "move_instance" then
		local targetPath = tostring(action.targetPath or "")
		if not raizVFXPermitida(targetPath) then
			warn("[Roblox AI] Destino rechazado fuera de los contenedores VFX permitidos:", targetPath)
			return false
		end
		local destination = obtenerContenedor(targetPath, false)
		if not destination then
			warn("[Roblox AI] Destino no encontrado:", targetPath)
			return false
		end

		if not padreVisualValido(object.ClassName, destination) then
			return false
		end

		if destination == object or object:IsDescendantOf(destination) then
			warn("[Roblox AI] MOVE rechazado: destino invalido.")
			return false
		end

		if destination:FindFirstChild(object.Name) then
			warn("[Roblox AI] MOVE rechazado: nombre ocupado en destino.")
			return false
		end

		local oldName = object:GetFullName()
		object.Parent = destination
		print("[Roblox AI] 📦 MOVIDO:", oldName, "→", object:GetFullName())
		ChangeHistoryService:SetWaypoint("OmniRoute mover " .. object.Name)
		return true
	end

	if tipo == "delete_instance" then
		local fullName = object:GetFullName()
		object:Destroy()
		print("[Roblox AI] 🗑 INSTANCIA ELIMINADA:", fullName)
		ChangeHistoryService:SetWaypoint("OmniRoute eliminar " .. name)
		return true
	end

	warn("[Roblox AI] Accion extendida desconocida:", tipo)
	return false
end

function ejecutarStudioTest(action)
	if type(action) ~= "table" then
		return false
	end

	local testId = tostring(action.testId or "")
	local numPlayers = math.max(1, math.min(8, tonumber(action.numPlayers) or 2))
	local duration = math.max(3, math.min(60, tonumber(action.duration) or 10))
	local serverCode = tostring(action.serverCode or "")
	local clientCode = tostring(action.clientCode or "")

	if testId == "" then
		warn("[Roblox AI] run_studio_test sin testId")
		return false
	end

	if serverCode == "" and clientCode == "" then
		warn("[Roblox AI] run_studio_test sin serverCode/clientCode")
		return false
	end

	local token = string.gsub(testId, "[^%w_]", "_")
	local folderName = "__RobloxAI_Test_" .. token
	local folder = Instance.new("Folder")
	folder.Name = folderName
	folder.Parent = game:GetService("ReplicatedStorage")

	local report = Instance.new("RemoteEvent")
	report.Name = "Report"
	report.Parent = folder

	local serverScript = Instance.new("Script")
	serverScript.Name = folderName .. "_Server"
	serverScript.Source = serverCode
	serverScript.Parent = folder

	local clientScript = Instance.new("LocalScript")
	clientScript.Name = folderName .. "_Client"
	clientScript.Source = clientCode
	clientScript.Parent = game:GetService("StarterPlayer"):WaitForChild("StarterPlayerScripts")

	local inicio = os.clock()
	local okRun, result = pcall(function()
		return StudioTestService:ExecuteMultiplayerTestAsync(numPlayers, duration)
	end)

	local logs = {}
	pcall(function()
		for _, entry in ipairs(LogService:GetLogHistory()) do
			table.insert(logs, {
				message = tostring(entry.message or ""),
				messageType = tostring(entry.messageType or ""),
				timestamp = tonumber(entry.timestamp) or 0
			})
		end
	end)

	local errors = 0
	local warnings = 0
	for _, entry in ipairs(logs) do
		local kind = string.lower(entry.messageType)
		if string.find(kind, "error", 1, true) then
			errors += 1
		elseif string.find(kind, "warning", 1, true) then
			warnings += 1
		end
	end

	local resultData = {
		testId = testId,
		ok = okRun and errors == 0,
		executionOk = okRun,
		result = result,
		duration = os.clock() - inicio,
		numPlayers = numPlayers,
		errorCount = errors,
		warningCount = warnings,
		logs = logs
	}

	pcall(function() folder:Destroy() end)
	pcall(function() clientScript:Destroy() end)

	local postOk, postResponse = pcall(function()
		return HttpService:RequestAsync({
			Url = TEST_RESULTS_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode(resultData)
		})
	end)

	if not postOk or not postResponse.Success then
		warn("[Roblox AI] No se pudo enviar resultado de test.")
	end

	if resultData.ok then
		print("[Roblox AI] ✅ TEST OK:", testId)
	else
		warn("[Roblox AI] ❌ TEST FALLÓ:", testId, tostring(result))
	end

	return resultData.ok
end

local function intentarAccionEmpaquetada(action)
	if type(action) ~= "table" or type(action.code) ~= "string" then
		return false, false
	end

	local marker = "__ROBLOX_AI_EXTENDED_ACTION__"
	if action.type ~= "update_script" or action.code:sub(1, #marker) ~= marker then
		return false, false
	end

	local json = action.code:sub(#marker + 1):gsub("^%s+", "")
	local ok, extended = pcall(function()
		return HttpService:JSONDecode(json)
	end)

	if not ok or type(extended) ~= "table" then
		warn("[Roblox AI] Acción extendida empaquetada inválida.")
		return true, false
	end

	return true, ejecutarExtendedAction(extended)
end

local function obtenerResumenAccion(action)
	local summary = {
		type = tostring(action.type or action.action or "unknown"),
		path = tostring(action.path or ""),
		name = tostring(action.name or action.nombre or ""),
		ok = false
	}
	local marker = "__ROBLOX_AI_EXTENDED_ACTION__"
	if summary.type == "update_script" and type(action.code) == "string" and action.code:sub(1, #marker) == marker then
		local ok, payload = pcall(function()
			return HttpService:JSONDecode(action.code:sub(#marker + 1):gsub("^%s+", ""))
		end)
		if ok and type(payload) == "table" then
			summary.type = tostring(payload.type or summary.type)
			summary.path = tostring(payload.path or summary.path)
			summary.name = tostring(payload.name or summary.name)
		end
	end
	return summary
end

local function ejecutarAccion(action)
	if type(action) ~= "table" then
		return false
	end

	local handled, packedSuccess = intentarAccionEmpaquetada(action)
	if handled then
		return packedSuccess
	end

	local tipo = string.lower(tostring(action.type or action.action or ""))
	action.type = tipo
	if not VFX_ACTION_TYPES[tipo] then
		warn("[Roblox AI] Acción rechazada: solo se aceptan acciones de creación y edición VFX.", tipo)
		return false
	end

	return ejecutarExtendedAction(action)
end

-- ============================================================
-- CAPTURA VISUAL DEL VIEWPORT
-- ============================================================

local CARACTERES_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function codificarBase64(datos)
	local salida = {}
	local indice = 1
	local largo = #datos
	while indice <= largo do
		local b1 = string.byte(datos, indice) or 0
		local b2 = string.byte(datos, indice + 1) or 0
		local b3 = string.byte(datos, indice + 2) or 0
		local numero = b1 * 65536 + b2 * 256 + b3
		local i1 = math.floor(numero / 262144) % 64
		local i2 = math.floor(numero / 4096) % 64
		local i3 = math.floor(numero / 64) % 64
		local i4 = numero % 64
		salida[#salida + 1] = CARACTERES_B64:sub(i1 + 1, i1 + 1)
		salida[#salida + 1] = CARACTERES_B64:sub(i2 + 1, i2 + 1)
		salida[#salida + 1] = CARACTERES_B64:sub(i3 + 1, i3 + 1)
		salida[#salida + 1] = CARACTERES_B64:sub(i4 + 1, i4 + 1)
		indice += 3
	end

	local resto = largo % 3
	if resto == 1 then
		salida[#salida] = "="
		salida[#salida - 1] = "="
	elseif resto == 2 then
		salida[#salida] = "="
	end

	return table.concat(salida)
end

local TABLA_CRC = table.create(256)
do
	for n = 0, 255 do
		local c = n
		for _ = 1, 8 do
			if bit32.band(c, 1) == 1 then
				c = bit32.bxor(3988292384, bit32.rshift(c, 1))
			else
				c = bit32.rshift(c, 1)
			end
		end
		TABLA_CRC[n + 1] = c
	end
end

local function crc32(texto)
	local crc = 4294967295
	for i = 1, #texto do
		local indice = bit32.bxor(bit32.band(crc, 255), string.byte(texto, i))
		crc = bit32.bxor(TABLA_CRC[(indice % 256) + 1], bit32.rshift(crc, 8))
	end
	return bit32.bxor(crc, 4294967295)
end

local function escribirPNG(ancho, alto, pixeles)
	local firma = string.char(137, 80, 78, 71, 13, 10, 26, 10)

	local ihdr = string.char(
		bit32.band(bit32.rshift(ancho, 24), 255),
		bit32.band(bit32.rshift(ancho, 16), 255),
		bit32.band(bit32.rshift(ancho, 8), 255),
		bit32.band(ancho, 255),
		bit32.band(bit32.rshift(alto, 24), 255),
		bit32.band(bit32.rshift(alto, 16), 255),
		bit32.band(bit32.rshift(alto, 8), 255),
		bit32.band(alto, 255),
		8, 6, 0, 0, 0
	)

	local anchoFila = ancho * 4
	local filas = alto * (1 + anchoFila)
	local crudo = buffer.create(filas)
	local posicion = 0
	for y = 0, alto - 1 do
		buffer.writeu8(crudo, posicion, 0)
		posicion += 1
		buffer.copy(crudo, posicion, pixeles, y * anchoFila, anchoFila)
		posicion += anchoFila
	end

	local sumaA, sumaB = 1, 0
	local i = 0
	while i < filas do
		local fin = math.min(i + 5552, filas)
		while i < fin do
			sumaA = (sumaA + buffer.readu8(crudo, i)) % 65521
			sumaB = (sumaB + sumaA) % 65521
			i += 1
		end
	end
	local adler = sumaA * 65536 + sumaB

	local partesZlib = {string.char(120, 1)}
	local restante = filas
	local leido = 0
	while restante > 0 do
		local trozo = math.min(restante, 65535)
		local ultimo = trozo == restante
		table.insert(partesZlib, string.char(ultimo and 1 or 0))
		table.insert(partesZlib, string.char(
			bit32.band(trozo, 255),
			bit32.band(bit32.rshift(trozo, 8), 255),
			bit32.bxor(bit32.band(trozo, 255), 255),
			bit32.bxor(bit32.band(bit32.rshift(trozo, 8), 255), 255)
		))
		table.insert(partesZlib, buffer.readstring(crudo, leido, trozo))
		restante -= trozo
		leido += trozo
	end
	table.insert(partesZlib, string.char(
		bit32.band(bit32.rshift(adler, 24), 255),
		bit32.band(bit32.rshift(adler, 16), 255),
		bit32.band(bit32.rshift(adler, 8), 255),
		bit32.band(adler, 255)
	))

	local funcionChunk = function(tipo, datos)
		local largo = #datos
		local suma = crc32(tipo .. datos)
		return string.char(
			bit32.band(bit32.rshift(largo, 24), 255),
			bit32.band(bit32.rshift(largo, 16), 255),
			bit32.band(bit32.rshift(largo, 8), 255),
			bit32.band(largo, 255)
		) .. tipo .. datos .. string.char(
			bit32.band(bit32.rshift(suma, 24), 255),
			bit32.band(bit32.rshift(suma, 16), 255),
			bit32.band(bit32.rshift(suma, 8), 255),
			bit32.band(suma, 255)
		)
	end

	local idat = table.concat(partesZlib)
	return firma
		.. funcionChunk("IHDR", ihdr)
		.. funcionChunk("IDAT", idat)
		.. funcionChunk("IEND", "")
end

local function reducirImagen(imagen, anchoObjetivo)
	local anchoOrigen = math.floor(imagen.Size.X)
	local altoOrigen = math.floor(imagen.Size.Y)
	if anchoOrigen < 1 or altoOrigen < 1 then
		return nil
	end
	local ancho = math.min(anchoObjetivo, anchoOrigen)
	local alto = math.max(1, math.floor(altoOrigen * ancho / anchoOrigen))
	local origen = imagen:ReadPixelsBuffer(Vector2.zero, imagen.Size)
	if buffer.len(origen) < ancho * alto * 4 then
		return nil
	end
	local destino = buffer.create(ancho * alto * 4)
	local pasoX = anchoOrigen / ancho
	local pasoY = altoOrigen / alto
	for y = 0, alto - 1 do
		local y0 = math.floor(y * pasoY)
		local y1 = math.max(y0 + 1, math.floor((y + 1) * pasoY))
		for x = 0, ancho - 1 do
			local x0 = math.floor(x * pasoX)
			local x1 = math.max(x0 + 1, math.floor((x + 1) * pasoX))
			local r, g, b, alfa, n = 0, 0, 0, 0, 0
			for yy = y0, y1 - 1 do
				local baseFila = yy * anchoOrigen * 4
				for xx = x0, x1 - 1 do
					local indice = baseFila + xx * 4
					r += buffer.readu8(origen, indice)
					g += buffer.readu8(origen, indice + 1)
					b += buffer.readu8(origen, indice + 2)
					alfa += buffer.readu8(origen, indice + 3)
					n += 1
				end
			end
			local destinoIndice = (y * ancho + x) * 4
			buffer.writeu8(destino, destinoIndice, math.floor(r / n))
			buffer.writeu8(destino, destinoIndice + 1, math.floor(g / n))
			buffer.writeu8(destino, destinoIndice + 2, math.floor(b / n))
			buffer.writeu8(destino, destinoIndice + 3, math.floor(alfa / n))
		end
	end
	return destino, ancho, alto
end

local camaraPrevia = nil

local function resolverRuta(ruta)
	if type(ruta) ~= "string" or ruta == "" then
		return nil
	end
	local segmentos = {}
	for parte in string.gmatch(ruta, "[^/.]+") do
		table.insert(segmentos, parte)
	end
	if #segmentos == 0 then
		return nil
	end
	local raiz = game
	local inicio = 1
	if segmentos[1] == "game" then
		inicio = 2
	else
		local ok, servicio = pcall(function()
			return game:GetService(segmentos[1])
		end)
		if ok and servicio then
			raiz = servicio
			inicio = 2
		end
	end
	local actual = raiz
	for i = inicio, #segmentos do
		if not actual then
			return nil
		end
		actual = actual:FindFirstChild(segmentos[i])
	end
	return actual
end

-- Resuelve el OBJETO afectado por una acción (path = contenedor, name = instancia).
-- Nunca devuelve Workspace/otro contenedor cuando una instancia nombrada no existe:
-- hacerlo haría que la proyección acabara recogiendo la escena entera.
local function resolverObjetivoResumen(resumen)
	if type(resumen) ~= "table" then
		return nil
	end

	local ruta = tostring(resumen.path or "")
	local nombre = tostring(resumen.name or "")
	if nombre == "" then
		return resolverRuta(ruta)
	end

	local directo = resolverRuta(ruta)
	if directo and directo.Name == nombre then
		return directo
	end

	if ruta ~= "" then
		local objetivo = resolverRuta(ruta .. "/" .. nombre)
		if objetivo then
			return objetivo
		end
		if directo then
			local hijo = directo:FindFirstChild(nombre)
			if hijo then
				return hijo
			end
		end
	end

	return nil
end

local function restaurarCamara()
	if camaraPrevia then
		local camara = workspace.CurrentCamera
		if camara then
			camara.CFrame = camaraPrevia
		end
		camaraPrevia = nil
	end
end

local function encuadrarEfecto(detalles)
	local camara = workspace.CurrentCamera
	if not camara then
		return
	end

	local minimo, maximo
	local function extender(punto)
		if not minimo then
			minimo, maximo = punto, punto
			return
		end
		minimo = Vector3.new(
			math.min(minimo.X, punto.X),
			math.min(minimo.Y, punto.Y),
			math.min(minimo.Z, punto.Z)
		)
		maximo = Vector3.new(
			math.max(maximo.X, punto.X),
			math.max(maximo.Y, punto.Y),
			math.max(maximo.Z, punto.Z)
		)
	end

	local function incluir(instancia)
		if instancia:IsA("BasePart") then
			local mitad = instancia.Size * 0.5
			for sx = -1, 1, 2 do
				for sy = -1, 1, 2 do
					for sz = -1, 1, 2 do
						extender(instancia.CFrame * Vector3.new(mitad.X * sx, mitad.Y * sy, mitad.Z * sz))
					end
				end
			end
		elseif instancia:IsA("Attachment") then
			extender(instancia.WorldPosition)
		end
	end

	local vistos = {}
	for _, resumen in ipairs(detalles) do
		if resumen.ok then
			local objetivo = resolverObjetivoResumen(resumen)
			if objetivo and not vistos[objetivo] then
				vistos[objetivo] = true
				incluir(objetivo)
				for _, descendiente in ipairs(objetivo:GetDescendants()) do
					incluir(descendiente)
				end
				-- Un emisor puede ser la única acción: incluye su Attachment/BasePart padre
				-- para encuadrar el origen real sin recorrer el Workspace completo.
				local ancestro = objetivo.Parent
				while ancestro and ancestro ~= workspace do
					if ancestro:IsA("BasePart") or ancestro:IsA("Attachment") then
						incluir(ancestro)
					end
					ancestro = ancestro.Parent
				end
			end
		end
	end

	if not minimo or not maximo then
		warn("[Roblox AI] No se pudo encuadrar el VFX: no se resolvieron instancias afectadas.")
		return
	end

	local centro = (minimo + maximo) / 2
	local tamano = math.max(1, (maximo - minimo).Magnitude)
	local distancia = tamano / (2 * math.tan(math.rad(camara.FieldOfView) / 2)) * 1.35 + 2
	distancia = math.clamp(distancia, 6, 1000)

	camaraPrevia = camara.CFrame
	camara.CFrame = CFrame.lookAt(centro + Vector3.new(0.35, 0.3, 1).Unit * distancia, centro)
	task.wait(0.1)
end
-- ============================================================
-- IMAGEN DE REVISION
-- ============================================================
-- No existe API soportada para leer los pixeles de una captura de
-- pantalla: CaptureService:CaptureScreenshot solo devuelve un id
-- temporal que se puede mostrar o guardar, y
-- AssetService:CreateEditableImageAsync lo rechaza con
-- "cannot currently create editable image from temporary texture id".
--
-- Lo que si se puede hacer es proyectar la geometria real de la escena
-- sobre el plano de la camara con la misma matematica que usa el motor
-- para colocar las cosas en pantalla. El resultado refleja composicion,
-- proporcion, distribucion, color y brillo de lo construido, y no
-- depende del renderizador.
-- ============================================================

local function colorPromedioDeSecuencia(secuencia)
	if typeof(secuencia) == "ColorSequence" then
		local r, g, b, n = 0, 0, 0, 0
		for _, punto in ipairs(secuencia.Keypoints) do
			local c = punto.Value
			r, g, b, n = r + c.R, g + c.G, b + c.B, n + 1
		end
		if n == 0 then
			return Color3.new(1, 1, 1)
		end
		return Color3.new(r / n, g / n, b / n)
	elseif typeof(secuencia) == "Color3" then
		return secuencia
	end
	return Color3.new(1, 1, 1)
end

local function tamanoPromedioDeSecuencia(secuencia)
	if typeof(secuencia) == "NumberSequence" then
		local suma, n = 0, 0
		for _, punto in ipairs(secuencia.Keypoints) do
			suma, n = suma + punto.Value, n + 1
		end
		if n > 0 then
			return suma / n
		end
	elseif typeof(secuencia) == "number" then
		return secuencia
	elseif typeof(secuencia) == "NumberRange" then
		return (secuencia.Min + secuencia.Max) / 2
	end
	return 1
end

-- Reune la geometria real afectada por la ultima tanda de acciones.
local function recolectarElementosVFX(detalles)
	local visitados, registrados = {}, {}
	local partes, emisores, luces, beams, trails, attachments, superficies = {}, {}, {}, {}, {}, {}, {}

	local function registrar(instancia)
		if not instancia or registrados[instancia] then return end
		registrados[instancia] = true
		if instancia:IsA("BasePart") then
			table.insert(partes, instancia)
		elseif instancia:IsA("ParticleEmitter") then
			table.insert(emisores, instancia)
		elseif instancia:IsA("Light") then
			table.insert(luces, instancia)
		elseif instancia:IsA("Beam") then
			table.insert(beams, instancia)
		elseif instancia:IsA("Trail") then
			table.insert(trails, instancia)
		elseif instancia:IsA("Attachment") then
			table.insert(attachments, instancia)
		elseif instancia:IsA("Decal") or instancia:IsA("Texture") then
			table.insert(superficies, instancia)
		end
	end

	local function visitar(instancia)
		if not instancia or visitados[instancia] then return end
		visitados[instancia] = true
		registrar(instancia)
		-- Registrar solamente ancestros físicos directos de un emisor/attachment;
		-- no descender desde ellos, porque eso volvería a incluir la escena completa.
		local ancestro = instancia.Parent
		while ancestro and ancestro ~= workspace do
			if ancestro:IsA("BasePart") or ancestro:IsA("Attachment") then
				registrar(ancestro)
			end
			ancestro = ancestro.Parent
		end
		for _, hijo in ipairs(instancia:GetDescendants()) do
			visitados[hijo] = true
			registrar(hijo)
		end
	end

	for _, resumen in ipairs(detalles) do
		if resumen.ok then
			visitar(resolverObjetivoResumen(resumen))
		end
	end

	return {
		partes = partes,
		emisores = emisores,
		luces = luces,
		beams = beams,
		trails = trails,
		attachments = attachments,
		superficies = superficies
	}
end

-- Envía metadatos visuales reales junto a la proyección. Ayudan a interpretar
-- attachments, texturas y clases que el dibujo sintético no puede rasterizar fielmente.
local function resumirElementosVFX(elementos)
	local lineas = {}
	local vistos = {}
	local function agregar(instancia, texto)
		if #lineas >= 100 or vistos[instancia] then
			return
		end
		vistos[instancia] = true
		lineas[#lineas + 1] = instancia:GetFullName() .. " | " .. texto
	end
	local function colorTexto(color)
		return string.format("#%02X%02X%02X", math.floor(color.R * 255 + 0.5), math.floor(color.G * 255 + 0.5), math.floor(color.B * 255 + 0.5))
	end
	local function obtener(instancia, propiedad, defecto)
		local ok, valor = pcall(function() return instancia[propiedad] end)
		if ok and valor ~= nil then return tostring(valor) end
		return defecto or "?"
	end

	for _, parte in ipairs(elementos.partes) do
		local forma = parte:IsA("Part") and obtener(parte, "Shape", "?") or parte.ClassName
		agregar(parte, string.format("PART clase=%s pos=%s size=%s color=%s material=%s transparency=%s shape=%s",
			parte.ClassName, tostring(parte.Position), tostring(parte.Size), colorTexto(parte.Color),
			tostring(parte.Material), tostring(parte.Transparency), forma))
	end
	for _, attachment in ipairs(elementos.attachments) do
		agregar(attachment, "ATTACHMENT worldPosition=" .. tostring(attachment.WorldPosition))
	end
	for _, emisor in ipairs(elementos.emisores) do
		agregar(emisor, string.format("PARTICLE enabled=%s rate=%s texture=%s color=%s size=%s speed=%s lifetime=%s lightEmission=%s",
			tostring(emisor.Enabled), tostring(emisor.Rate), tostring(emisor.Texture), obtener(emisor, "Color"),
			obtener(emisor, "Size"), tostring(emisor.Speed), tostring(emisor.Lifetime), tostring(emisor.LightEmission)))
	end
	for _, luz in ipairs(elementos.luces) do
		agregar(luz, string.format("LIGHT enabled=%s color=%s brightness=%s range=%s",
			tostring(luz.Enabled), colorTexto(luz.Color), tostring(luz.Brightness), tostring(luz.Range)))
	end
	for _, beam in ipairs(elementos.beams) do
		agregar(beam, string.format("BEAM enabled=%s attachment0=%s attachment1=%s width0=%s width1=%s texture=%s color=%s transparency=%s",
			tostring(beam.Enabled), beam.Attachment0 and beam.Attachment0:GetFullName() or "?",
			beam.Attachment1 and beam.Attachment1:GetFullName() or "?", tostring(beam.Width0), tostring(beam.Width1),
			tostring(beam.Texture), tostring(beam.Color), tostring(beam.Transparency)))
	end
	for _, trail in ipairs(elementos.trails) do
		agregar(trail, string.format("TRAIL enabled=%s attachment0=%s attachment1=%s lifetime=%s texture=%s color=%s widthScale=%s",
			tostring(trail.Enabled), trail.Attachment0 and trail.Attachment0:GetFullName() or "?",
			trail.Attachment1 and trail.Attachment1:GetFullName() or "?", tostring(trail.Lifetime),
			tostring(trail.Texture), tostring(trail.Color), tostring(trail.WidthScale)))
	end
	for _, superficie in ipairs(elementos.superficies) do
		agregar(superficie, string.format("SURFACE clase=%s face=%s texture=%s color=%s transparency=%s",
			superficie.ClassName, obtener(superficie, "Face"), obtener(superficie, "Texture"),
			obtener(superficie, "Color3", obtener(superficie, "Color")), obtener(superficie, "Transparency")))
	end

	local texto = table.concat(lineas, "\n")
	if #texto > 18000 then
		texto = string.sub(texto, 1, 18000) .. "\n[resumen truncado]"
	end
	return texto
end

-- Proyección sintética: no sustituye el render de Studio y no lee píxeles reales.
local function proyectarEscena(elementos, anchoObjetivo)
	local camara = workspace.CurrentCamera
	if not camara then return nil end
	local vista = camara.ViewportSize
	if vista.X < 1 or vista.Y < 1 then return nil end

	local ancho = math.max(8, math.min(anchoObjetivo, math.floor(vista.X)))
	local alto = math.max(8, math.floor(ancho * vista.Y / vista.X))
	local pixeles = buffer.create(ancho * alto * 4)
	for i = 0, ancho * alto - 1 do
		buffer.writeu8(pixeles, i * 4, 16)
		buffer.writeu8(pixeles, i * 4 + 1, 17)
		buffer.writeu8(pixeles, i * 4 + 2, 22)
		buffer.writeu8(pixeles, i * 4 + 3, 255)
	end

	local escalaX = ancho / vista.X
	local escalaY = alto / vista.Y
	local fov = math.rad(camara.FieldOfView)
	local function pixelesPorStud(distancia)
		if distancia <= 0.01 then return alto end
		return alto / (2 * distancia * math.tan(fov / 2))
	end
	local function proyectarPunto(posicion)
		local p = camara:WorldToViewportPoint(posicion)
		if p.Z <= 0.01 then return nil end
		return {punto = Vector2.new(p.X * escalaX, p.Y * escalaY), z = p.Z}
	end
	local function pintarPixel(x, y, r, g, b, alfa)
		if alfa <= 0 or x < 0 or y < 0 or x >= ancho or y >= alto then return end
		local i = (y * ancho + x) * 4
		local fr = buffer.readu8(pixeles, i) / 255
		local fg = buffer.readu8(pixeles, i + 1) / 255
		local fb = buffer.readu8(pixeles, i + 2) / 255
		buffer.writeu8(pixeles, i, math.clamp(math.floor((r * alfa + fr * (1 - alfa)) * 255 + 0.5), 0, 255))
		buffer.writeu8(pixeles, i + 1, math.clamp(math.floor((g * alfa + fg * (1 - alfa)) * 255 + 0.5), 0, 255))
		buffer.writeu8(pixeles, i + 2, math.clamp(math.floor((b * alfa + fb * (1 - alfa)) * 255 + 0.5), 0, 255))
	end
	local function pintarCaja(minimo, maximo, color, alfa)
		local x0, x1 = math.max(0, math.floor(minimo.X)), math.min(ancho - 1, math.ceil(maximo.X))
		local y0, y1 = math.max(0, math.floor(minimo.Y)), math.min(alto - 1, math.ceil(maximo.Y))
		for y = y0, y1 do
			for x = x0, x1 do
				pintarPixel(x, y, color.R, color.G, color.B, alfa)
			end
		end
	end
	local function pintarPoligono(puntos, color, alfa)
		if #puntos < 3 or alfa <= 0 then return end
		local minY, maxY = alto - 1, 0
		for _, p in ipairs(puntos) do
			minY = math.min(minY, p.Y)
			maxY = math.max(maxY, p.Y)
		end
		minY, maxY = math.max(0, math.floor(minY)), math.min(alto - 1, math.ceil(maxY))
		for y = minY, maxY do
			local scanY = y + 0.5
			local cruces = {}
			for i = 1, #puntos do
				local a = puntos[i]
				local b = puntos[i % #puntos + 1]
				if (a.Y <= scanY and b.Y > scanY) or (b.Y <= scanY and a.Y > scanY) then
					local t = (scanY - a.Y) / (b.Y - a.Y)
					cruces[#cruces + 1] = a.X + t * (b.X - a.X)
				end
			end
			table.sort(cruces)
			for i = 1, #cruces - 1, 2 do
				local x0 = math.max(0, math.ceil(cruces[i]))
				local x1 = math.min(ancho - 1, math.floor(cruces[i + 1]))
				for x = x0, x1 do
					pintarPixel(x, y, color.R, color.G, color.B, alfa)
				end
			end
		end
	end
	local function pintarElipse(centro, rx, ry, color, alfa)
		rx, ry = math.max(1, rx), math.max(1, ry)
		local x0, x1 = math.max(0, math.floor(centro.X - rx)), math.min(ancho - 1, math.ceil(centro.X + rx))
		local y0, y1 = math.max(0, math.floor(centro.Y - ry)), math.min(alto - 1, math.ceil(centro.Y + ry))
		for y = y0, y1 do
			for x = x0, x1 do
				local dx = (x + 0.5 - centro.X) / rx
				local dy = (y + 0.5 - centro.Y) / ry
				if dx * dx + dy * dy <= 1 then
					pintarPixel(x, y, color.R, color.G, color.B, alfa)
				end
			end
		end
	end
	local function pintarSegmento(a, b, radio, color, alfa)
		radio = math.max(1, radio)
		local x0, x1 = math.max(0, math.floor(math.min(a.X, b.X) - radio)), math.min(ancho - 1, math.ceil(math.max(a.X, b.X) + radio))
		local y0, y1 = math.max(0, math.floor(math.min(a.Y, b.Y) - radio)), math.min(alto - 1, math.ceil(math.max(a.Y, b.Y) + radio))
		local vx, vy = b.X - a.X, b.Y - a.Y
		local largo2 = vx * vx + vy * vy
		for y = y0, y1 do
			for x = x0, x1 do
				local t = largo2 > 0 and math.clamp(((x + 0.5 - a.X) * vx + (y + 0.5 - a.Y) * vy) / largo2, 0, 1) or 0
				local dx, dy = x + 0.5 - (a.X + vx * t), y + 0.5 - (a.Y + vy * t)
				if dx * dx + dy * dy <= radio * radio then
					pintarPixel(x, y, color.R, color.G, color.B, alfa)
				end
			end
		end
	end
	local function brilloRadial(centro, radio, color, intensidad)
		radio = math.max(1, radio)
		local x0, x1 = math.max(0, math.floor(centro.X - radio)), math.min(ancho - 1, math.ceil(centro.X + radio))
		local y0, y1 = math.max(0, math.floor(centro.Y - radio)), math.min(alto - 1, math.ceil(centro.Y + radio))
		for y = y0, y1 do
			for x = x0, x1 do
				local dx, dy = x - centro.X, y - centro.Y
				local d = math.sqrt(dx * dx + dy * dy) / radio
				if d < 1 then
					pintarPixel(x, y, color.R, color.G, color.B, intensidad * (1 - d) * (1 - d))
				end
			end
		end
	end
	local function promedioColor(secuencia)
		if typeof(secuencia) == "ColorSequence" then
			local r, g, b, n = 0, 0, 0, 0
			for _, punto in ipairs(secuencia.Keypoints) do
				r, g, b, n = r + punto.Value.R, g + punto.Value.G, b + punto.Value.B, n + 1
			end
			if n > 0 then return Color3.new(r / n, g / n, b / n) end
		elseif typeof(secuencia) == "Color3" then
			return secuencia
		end
		return Color3.new(1, 1, 1)
	end
	local function promedioNumero(secuencia, defecto)
		if typeof(secuencia) == "NumberSequence" then
			local suma, n = 0, 0
			for _, punto in ipairs(secuencia.Keypoints) do suma, n = suma + punto.Value, n + 1 end
			if n > 0 then return suma / n end
		elseif typeof(secuencia) == "number" then
			return secuencia
		elseif typeof(secuencia) == "NumberRange" then
			return (secuencia.Min + secuencia.Max) / 2
		end
		return defecto or 1
	end
	local function opacidad(secuencia)
		return math.clamp(1 - promedioNumero(secuencia, 0), 0, 1)
	end
	local function puntoVisual(instancia)
		local padre = instancia and instancia.Parent
		if padre and padre:IsA("Attachment") then return padre.WorldPosition end
		if padre and padre:IsA("BasePart") then return padre.Position end
		if instancia and instancia:IsA("Attachment") then return instancia.WorldPosition end
		return nil
	end
	local function colorParte(parte)
		local c = parte.Color
		if parte.Material == Enum.Material.Neon or parte.Material == Enum.Material.Glass then
			return Color3.new(math.min(1, c.R * 1.25 + 0.12), math.min(1, c.G * 1.25 + 0.12), math.min(1, c.B * 1.25 + 0.12))
		end
		return c
	end

	local signos = {
		Vector3.new(-1, -1, -1), Vector3.new(-1, -1, 1),
		Vector3.new(-1, 1, -1), Vector3.new(-1, 1, 1),
		Vector3.new(1, -1, -1), Vector3.new(1, -1, 1),
		Vector3.new(1, 1, -1), Vector3.new(1, 1, 1)
	}
	local caras = {
		{1, 2, 4, 3}, {5, 7, 8, 6}, {1, 5, 6, 2},
		{3, 4, 8, 7}, {1, 3, 7, 5}, {2, 6, 8, 4}
	}
	local caraPorNombre = {
		Left = {1, 2, 4, 3}, Right = {5, 7, 8, 6},
		Bottom = {1, 5, 6, 2}, Top = {3, 4, 8, 7},
		Front = {1, 3, 7, 5}, Back = {2, 6, 8, 4}
	}
	local dibujos = {}
	for _, parte in ipairs(elementos.partes) do
		local mitad = parte.Size * 0.5
		local proyecciones, puntosValidos = {}, {}
		local minP, maxP, profundidad = nil, nil, nil
		for indice, signo in ipairs(signos) do
			local world = parte.CFrame * Vector3.new(mitad.X * signo.X, mitad.Y * signo.Y, mitad.Z * signo.Z)
			local proy = proyectarPunto(world)
			proyecciones[indice] = proy
			if proy then
				puntosValidos[#puntosValidos + 1] = proy
				minP = minP and Vector2.new(math.min(minP.X, proy.punto.X), math.min(minP.Y, proy.punto.Y)) or proy.punto
				maxP = maxP and Vector2.new(math.max(maxP.X, proy.punto.X), math.max(maxP.Y, proy.punto.Y)) or proy.punto
				profundidad = profundidad and math.min(profundidad, proy.z) or proy.z
			end
		end
		local alfa = math.clamp(1 - parte.Transparency, 0, 1)
		local color = colorParte(parte)
		local esBola = parte:IsA("Part") and parte.Shape == Enum.PartType.Ball
		if alfa > 0 then
			if #puntosValidos == 8 and esBola then
				local centroProy = proyectarPunto(parte.Position)
				if centroProy then
					dibujos[#dibujos + 1] = {
						kind = "ellipse", center = centroProy.punto,
						rx = math.max(1, (maxP.X - minP.X) / 2), ry = math.max(1, (maxP.Y - minP.Y) / 2),
						color = color, alpha = alfa, z = centroProy.z
					}
				end
			elseif #puntosValidos == 8 then
				for _, indices in ipairs(caras) do
					local puntos, sumaZ, completos = {}, 0, true
					for _, indice in ipairs(indices) do
						local proy = proyecciones[indice]
						if not proy then completos = false break end
						puntos[#puntos + 1] = proy.punto
						sumaZ += proy.z
					end
					if completos then
						dibujos[#dibujos + 1] = {
							kind = "polygon", points = puntos, color = color, alpha = alfa,
							z = sumaZ / #indices
						}
					end
				end
			elseif minP and maxP then
				dibujos[#dibujos + 1] = {kind = "rect", min = minP, max = maxP, color = color, alpha = alfa, z = profundidad or 1}
			end
		end

		-- Los Decal/Texture no pueden rasterizarse aquí como píxeles reales.
		-- Se dibuja solo un plano tintado tenue y se envía la URI al revisor.
		if #puntosValidos == 8 then
			for _, superficie in ipairs(parte:GetChildren()) do
				if superficie:IsA("Decal") or superficie:IsA("Texture") then
					local indices = caraPorNombre[superficie.Face.Name]
					local uri = tostring(superficie.Texture or "")
					if indices and uri ~= "" then
						local puntos, sumaZ = {}, 0
						for _, indice in ipairs(indices) do
							puntos[#puntos + 1] = proyecciones[indice].punto
							sumaZ += proyecciones[indice].z
						end
						local tintado = Color3.new(1, 1, 1)
						if superficie:IsA("Decal") then tintado = superficie.Color3 end
						local trans = superficie.Transparency or 0
						dibujos[#dibujos + 1] = {
							kind = "polygon", points = puntos, color = tintado,
							alpha = math.clamp((1 - trans) * 0.18, 0.04, 0.18),
							z = sumaZ / #indices + 0.001
						}
					end
				end
			end
		end
	end

	-- Los halos y las líneas usan la posición real de Attachments, no la del Part padre.
	for _, luz in ipairs(elementos.luces) do
		if luz.Enabled then
			local world = puntoVisual(luz)
			local proy = world and proyectarPunto(world)
			if proy then
				local radio = math.clamp((luz.Range or 8) * pixelesPorStud(proy.z) * 0.45, 2, math.max(ancho, alto) * 0.45)
				dibujos[#dibujos + 1] = {
					kind = "halo", center = proy.punto, radius = radio,
					color = luz.Color, alpha = math.clamp((luz.Brightness or 1) / 3, 0.08, 0.55), z = proy.z
				}
			end
		end
	end
	for _, emisor in ipairs(elementos.emisores) do
		if emisor.Enabled and emisor.Rate > 0 then
			local world = puntoVisual(emisor)
			local proy = world and proyectarPunto(world)
			if proy then
				local escala = pixelesPorStud(proy.z)
				local radio = math.clamp(tamanoPromedioDeSecuencia(emisor.Size) * escala * 0.3, 1.5, 15)
				local velocidad = typeof(emisor.Speed) == "NumberRange" and (emisor.Speed.Min + emisor.Speed.Max) / 2 or 0
				local vida = typeof(emisor.Lifetime) == "NumberRange" and (emisor.Lifetime.Min + emisor.Lifetime.Max) / 2 or 1
				local extension = math.clamp(velocidad * vida * escala * 0.25, radio, math.max(ancho, alto) * 0.35)
				local cantidad = math.clamp(math.floor(emisor.Rate / 5) + 3, 4, 18)
				local color = promedioColor(emisor.Color)
				local brillo = math.clamp(0.22 + (emisor.LightEmission or 0) * 0.35, 0.12, 0.6)
				for i = 1, cantidad do
					local angulo = i * 2.39996
					local distancia = extension * math.sqrt(i / cantidad)
					local center = proy.punto + Vector2.new(math.cos(angulo) * distancia, math.sin(angulo) * distancia * 0.85)
					dibujos[#dibujos + 1] = {kind = "halo", center = center, radius = radio, color = color, alpha = brillo, z = proy.z}
				end
			end
		end
	end
	for _, beam in ipairs(elementos.beams) do
		if beam.Enabled and beam.Attachment0 and beam.Attachment1 then
			local a = proyectarPunto(beam.Attachment0.WorldPosition)
			local b = proyectarPunto(beam.Attachment1.WorldPosition)
			if a and b then
				local escala = pixelesPorStud((a.z + b.z) / 2)
				local grosor = math.clamp(((beam.Width0 + beam.Width1) / 2) * escala * 0.5, 1, 24)
				dibujos[#dibujos + 1] = {kind = "line", a = a.punto, b = b.punto, radius = grosor,
					color = promedioColor(beam.Color), alpha = opacidad(beam.Transparency), z = (a.z + b.z) / 2}
			end
		end
	end
	for _, trail in ipairs(elementos.trails) do
		if trail.Enabled and trail.Attachment0 and trail.Attachment1 then
			local a = proyectarPunto(trail.Attachment0.WorldPosition)
			local b = proyectarPunto(trail.Attachment1.WorldPosition)
			if a and b then
				local escala = pixelesPorStud((a.z + b.z) / 2)
				local anchoMedio = promedioNumero(trail.WidthScale, 1)
				local grosor = math.clamp(anchoMedio * escala * 0.5, 1, 24)
				dibujos[#dibujos + 1] = {kind = "line", a = a.punto, b = b.punto, radius = grosor,
					color = promedioColor(trail.Color), alpha = opacidad(trail.Transparency), z = (a.z + b.z) / 2}
			end
		end
	end

	-- Painter's algorithm: aproxima oclusión por profundidad, no por píxel.
	table.sort(dibujos, function(a, b) return a.z > b.z end)
	for _, dibujo in ipairs(dibujos) do
		if dibujo.kind == "polygon" then
			pintarPoligono(dibujo.points, dibujo.color, dibujo.alpha)
		elseif dibujo.kind == "ellipse" then
			pintarElipse(dibujo.center, dibujo.rx, dibujo.ry, dibujo.color, dibujo.alpha)
		elseif dibujo.kind == "rect" then
			pintarCaja(dibujo.min, dibujo.max, dibujo.color, dibujo.alpha)
		elseif dibujo.kind == "line" then
			pintarSegmento(dibujo.a, dibujo.b, dibujo.radius, dibujo.color, dibujo.alpha)
		elseif dibujo.kind == "halo" then
			brilloRadial(dibujo.center, dibujo.radius, dibujo.color, dibujo.alpha)
		end
	end

	return ancho, alto, pixeles
end
local capturaEnCurso = false

local function enviarCapturaVisual(detalles, alTerminar)
	if capturaEnCurso then
		if alTerminar then
			alTerminar()
		end
		return
	end
	capturaEnCurso = true

	local cerrado = false
	local function terminar(ok, mensaje)
		if cerrado then
			return
		end
		cerrado = true
		restaurarCamara()
		if not ok then
			warn("[Roblox AI] Captura visual omitida:", mensaje)
		end
		capturaEnCurso = false
		if alTerminar then
			alTerminar()
		end
	end

	-- Encuadrar la camara sobre el efecto: la proyeccion usa esa misma camara.
	encuadrarEfecto(detalles)

	local elementos = recolectarElementosVFX(detalles)
	local okProyectar, ancho, alto, pixeles = pcall(proyectarEscena, elementos, CAPTURA_ANCHO_MAX)
	if not okProyectar or not pixeles then
		terminar(false, "no se pudo proyectar la escena: " .. tostring(ancho))
		return
	end

	local okPng, png = pcall(escribirPNG, ancho, alto, pixeles)
	if not okPng or not png then
		terminar(false, "no se pudo codificar el PNG")
		return
	end

	local base64 = codificarBase64(png)
	local okEnvio, respuesta = pcall(function()
		return HttpService:RequestAsync({
			Url = VISUAL_CAPTURE_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				imageBase64 = base64,
				resolution = {width = ancho, height = alto},
				tipo = "proyeccion",
				sceneSummary = resumirElementosVFX(elementos),
				nota = "Proyeccion sintetica aproximada, no captura del render de Studio. Las texturas se representan solo como caras tintadas; iluminacion, sombras, mallas y particulas simuladas no se rasterizan fielmente. Usa sceneSummary para interpretar clases y propiedades reales."
			})
		})
	end)
	if not okEnvio or not respuesta.Success then
		terminar(false, "el servidor rechazo la imagen de revision")
		return
	end
	print(string.format("[Roblox AI] Proyeccion de la escena enviada (%dx%d) para revision visual", ancho, alto))
	terminar(true)

	task.delay(MAX_ESPERA_CAPTURA, function()
		terminar(false, "tiempo agotado")
	end)
end

local function informarResultadoAcciones(solicitadas, exitosas, fallidas, detalles)
	local reportOk, reportResponse = pcall(function()
		return HttpService:RequestAsync({
			Url = EXECUTION_RESULTS_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Accept"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				requested = solicitadas,
				successful = exitosas,
				failed = fallidas,
				actions = detalles
			})
		})
	end)
	if not reportOk or not reportResponse.Success then
		warn("[Roblox AI] No se pudo informar el resultado de las acciones al servidor.")
	end
	ChangeHistoryService:SetWaypoint("Cambios VFX completados")

	if exitosas > 0 then
		escanearProyecto()
	end
end

local function consultarServidor()
	if consultando or not conectado then
		return
	end

	consultando = true

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = NEXT_URL,
			Method = "GET"
		})
	end)

	consultando = false

	if not ok or not response.Success then
		return
	end

	local jsonOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)

	if not jsonOk or type(data) ~= "table" or type(data.actions) ~= "table" then
		return
	end

	if #data.actions == 0 then
		return
	end

	print("[Roblox AI] 📥 Acciones VFX:", #data.actions)
	ChangeHistoryService:SetWaypoint("Antes de cambios OmniRoute")

	local exitosas = 0
	local fallidas = 0
	local detalles = {}

	for _, action in ipairs(data.actions) do
		local resumen = obtenerResumenAccion(action)
		local okAction, resultado = pcall(function()
			return ejecutarAccion(action)
		end)
		resumen.ok = okAction and resultado == true
		table.insert(detalles, resumen)

		if resumen.ok then
			exitosas += 1
		else
			fallidas += 1
			if not okAction then
				warn("[Roblox AI] Error ejecutando accion:", resultado)
			end
		end
	end

	print("[Roblox AI] Resultado acciones: " .. exitosas .. " exitosas | " .. fallidas .. " fallidas")

	-- verify_textures/verify_models son tareas internas de búsqueda, no cambios de VFX.
	-- No proyectar ni disparar una revisión visual vacía antes de que termine la búsqueda.
	local requiereRevisionVisual = false
	for _, resumen in ipairs(detalles) do
		if resumen.ok and resumen.type ~= "verify_textures" and resumen.type ~= "verify_models" then
			requiereRevisionVisual = true
			break
		end
	end

	if exitosas > 0 and requiereRevisionVisual then
		enviarCapturaVisual(detalles, function()
			informarResultadoAcciones(#data.actions, exitosas, fallidas, detalles)
		end)
		return
	end

	informarResultadoAcciones(#data.actions, exitosas, fallidas, detalles)
end

local function iniciarLoops()
	task.spawn(function()
		while conectado do
			consultarServidor()
			task.wait(1)
		end
	end)

	task.spawn(function()
		while conectado do
			if os.clock() - ultimoEscaneo >= INTERVALO_ESCANEO then
				escanearProyecto()
			end
			task.wait(5)
		end
	end)
end

button.Click:Connect(function()
	-- El print rutinario está silenciado; estos diagnósticos sí deben aparecer en Output.
	warnOriginal("[Roblox AI][DIAGNOSTIC] Clic del botón recibido.")

	local ok, err = xpcall(function()
		if conectado then
			conectado = false
			pcall(function()
				button:SetActive(false)
			end)
			warnOriginal("[Roblox AI][DIAGNOSTIC] Plugin desconectado por el usuario.")
			return
		end

		if not comprobarServidor() then
			warnOriginal("[Roblox AI][DIAGNOSTIC] No se pudo activar el plugin: el servidor local no respondió correctamente. Revisa el error de conexión anterior.")
			return
		end

		conectado = true
		button:SetActive(true)
		warnOriginal("[Roblox AI][DIAGNOSTIC] Servidor local disponible; conexión activada.")

		local scanOk, scanResult = pcall(escanearProyecto)
		if not scanOk then
			warnOriginal("[Roblox AI][DIAGNOSTIC_ERROR] Falló el escaneo inicial: " .. tostring(scanResult) .. "\\n" .. debug.traceback())
		elseif scanResult == false then
			warnOriginal("[Roblox AI][DIAGNOSTIC_WARN] El escaneo inicial no pudo completarse; revisa errores de HTTP/permisos.")
		end

		iniciarLoops()
	end, function(callbackError)
		return tostring(callbackError) .. "\\n" .. debug.traceback()
	end)

	if not ok then
		conectado = false
		pcall(function()
			button:SetActive(false)
		end)
		warnOriginal("[Roblox AI][DIAGNOSTIC_ERROR] Excepción al procesar el clic: " .. tostring(err))
	end
end)
