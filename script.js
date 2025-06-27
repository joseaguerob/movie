// Definición de variables globales para el modelo fuzzy
let fuzzyModel = null;
// Las clases de calidad del café, mapeadas a índices numéricos para consistencia.
// Baja -> 0, Media -> 1, Alta -> 2
const classes = ['Baja', 'Media', 'Alta']; 

// Referencias a elementos del DOM para interactuar con la interfaz de usuario
const predictBtn = document.getElementById('predictBtn');
const loadingDiv = document.getElementById('loading');
const resultDiv = document.getElementById('result');
const qualityPredictionP = document.getElementById('qualityPrediction');
const probabilityDetailsDiv = document.getElementById('probabilityDetails');
const warningMessageDiv = document.getElementById('warningMessage');

// ==============================
// 1. Funciones de Pertenencia (equivalente a skfuzzy.trimf en Python)
//    Esta función es el corazón de la fuzzificación en JavaScript.
// ==============================

/**
 * Calcula el grado de pertenencia de un valor 'x' a una función de pertenencia triangular.
 * Una función triangular se define por tres puntos: 'a' (inicio de la base),
 * 'b' (el pico donde la pertenencia es 1), y 'c' (fin de la base).
 * @param {number} x El valor para el cual se calcula el grado de pertenencia.
 * @param {number} a El punto inicial de la base del triángulo.
 * @param {number} b El pico (punto donde la pertenencia es 1) del triángulo.
 * @param {number} c El punto final de la base del triángulo.
 * @returns {number} El grado de pertenencia (un valor entre 0 y 1).
 */
function triangularMembership(x, a, b, c) {
    if (x <= a || x >= c) return 0; // Si 'x' está fuera de la base, la pertenencia es 0.
    if (x === b) return 1; // Si 'x' está en el pico, la pertenencia es 1.
    if (x > a && x < b) return (x - a) / (b - a); // Lado izquierdo ascendente del triángulo.
    if (x > b && x < c) return (c - x) / (c - b); // Lado derecho descendente del triángulo.
    return 0; // Fallback para cualquier caso no cubierto explícitamente (debería ser raro).
}

// ==============================
// 2. Carga del Modelo Fuzzy JSON
//    Esta función carga la definición de las variables fuzzy y las reglas.
// ==============================

/**
 * Carga el modelo fuzzy desde el archivo `modelo_fuzzy_cafe.json`.
 * Muestra y oculta un indicador de carga para la experiencia del usuario.
 */
async function loadFuzzyModel() {
    loadingDiv.classList.remove('hidden'); // Muestra el indicador de carga.
    try {
        const fuzzyResponse = await fetch('modelo_fuzzy_cafe.json');
        // Verifica si la carga del archivo fue exitosa (código de estado HTTP 200-299).
        if (!fuzzyResponse.ok) {
            throw new Error(`Error al cargar 'modelo_fuzzy_cafe.json': ${fuzzyResponse.statusText}`);
        }
        fuzzyModel = await fuzzyResponse.json(); // Parsea el JSON a un objeto JavaScript.
        console.log('Modelo Fuzzy cargado exitosamente:', fuzzyModel);

        loadingDiv.classList.add('hidden'); // Oculta el indicador de carga.
        predictBtn.disabled = false; // Habilita el botón de predicción.
    } catch (error) {
        console.error('Error cargando el modelo fuzzy:', error);
        loadingDiv.textContent = 'Error al cargar el modelo. Asegúrate de que "modelo_fuzzy_cafe.json" esté en la raíz del mismo directorio.';
        loadingDiv.classList.remove('hidden');
        loadingDiv.classList.add('text-red-600'); // Muestra el mensaje de error en rojo.
        predictBtn.disabled = true; // Deshabilita el botón si hay un error.
    }
}

// ==============================
// 3. Cálculo de Grados de Pertenencia (Fuzzificación)
//    Convierte los valores numéricos de entrada en "grados" de pertenencia lingüística.
// ==============================

/**
 * Calcula los grados de pertenencia de un valor numérico 'x' para todos los términos
 * lingüísticos (ej., 'baja', 'media', 'alta') de una variable fuzzy específica.
 * @param {number} x El valor de entrada (ej., acidez 6.5).
 * @param {string} variableName El nombre de la variable (ej., 'acidez', 'cafeina').
 * @returns {Object<string, number>} Un objeto donde las claves son los nombres de los términos
 * y los valores son sus grados de pertenencia.
 */
function computeMemberships(x, variableName) {
    const termMemberships = {};
    const varDef = fuzzyModel.inputs[variableName]; // Obtiene la definición de la variable del JSON.

    // Determinar los límites del universo de discurso para esta variable.
    // Esto es crucial para validar si el valor de entrada está dentro de un rango manejable.
    let universeMin = Infinity;
    let universeMax = -Infinity;
    for (const termName in varDef) {
        const params = varDef[termName];
        universeMin = Math.min(universeMin, params[0]);
        universeMax = Math.max(universeMax, params[2]);
    }

    // Validar si el valor de entrada está dentro del rango definido.
    if (x < universeMin || x > universeMax) {
        console.warn(`Advertencia: El valor ${x} para '${variableName}' está fuera del rango esperado [${universeMin}, ${universeMax}].`);
        // Si el valor está fuera de rango, no pertenece a ningún término, así que todas las membresías son 0.
        for (const termName in varDef) {
            termMemberships[termName] = 0.0;
        }
        return termMemberships;
    }

    // Calcula el grado de pertenencia para cada término lingüístico (ej., 'baja', 'media', 'alta').
    for (const termName in varDef) {
        const params = varDef[termName]; // Obtiene los puntos (a, b, c) del triángulo.
        termMemberships[termName] = triangularMembership(x, params[0], params[1], params[2]);
    }
    return termMemberships;
}

// ==============================
// 4. Inferencia Fuzzy y Defuzzificación
//    Aplica las reglas fuzzy y convierte los resultados difusos en una clasificación clara.
// ==============================

/**
 * Realiza el proceso de inferencia fuzzy y defuzzificación.
 * - Calcula la fuerza de activación de cada regla (min de las membresías antecedentes).
 * - Agrega la fuerza de las reglas a la puntuación de cada clase de salida.
 * - Finalmente, determina la clase de calidad predicha (Baja, Media, Alta) y su "probabilidad"
 * relativa basada en las puntuaciones agregadas.
 * @param {Object} inputMemberships Un objeto que contiene los grados de pertenencia
 * para cada variable de entrada (ej. {acidez: {baja: 0.2, ...}}).
 * @returns {Object} Un objeto con:
 * - `predictedClassIndex`: El índice numérico de la clase predicha (0, 1, o 2).
 * - `probabilities`: Un array de las "probabilidades" normalizadas para cada clase.
 */
function fuzzyInference(inputMemberships) {
    // Inicializa las puntuaciones agregadas para cada clase de salida.
    const classScores = { 0: 0, 1: 0, 2: 0 }; // 0: Baja, 1: Media, 2: Alta

    // Iterar sobre cada regla definida en el modelo fuzzy JSON.
    fuzzyModel.rules.forEach(rule => {
        let ruleActivationStrength = 1.0; // La fuerza de activación de la regla, inicialmente máxima.

        // Calcula la fuerza de activación de la regla.
        // Usamos el operador AND (mínimo) para combinar los antecedentes de la regla.
        for (const antecedentVarName in rule.antecedents) {
            const antecedentTermName = rule.antecedents[antecedentVarName];
            // Obtiene el grado de pertenencia del término antecedente para la variable actual.
            const membershipValue = inputMemberships[antecedentVarName][antecedentTermName];
            ruleActivationStrength = Math.min(ruleActivationStrength, membershipValue);
        }

        // Mapea el término consecuente de la regla a su índice numérico de clase.
        let consequentClassIndex;
        if (rule.consequent === 'baja') consequentClassIndex = 0;
        else if (rule.consequent === 'media') consequentClassIndex = 1;
        else if (rule.consequent === 'alta') consequentClassIndex = 2;

        // Agrega la fuerza de activación de la regla a la puntuación de la clase correspondiente.
        classScores[consequentClassIndex] += ruleActivationStrength;
    });

    // --- Defuzzificación (para clases discretas) ---
    // En este enfoque simplificado, seleccionamos la clase con la mayor puntuación agregada.
    // También calculamos "probabilidades" normalizando estas puntuaciones.
    let predictedClassIndex = 0;
    let maxScore = -1;
    let totalScore = 0;

    // Calcula la suma total de las puntuaciones de clase y encuentra la puntuación máxima.
    for (const classIdx in classScores) {
        totalScore += classScores[classIdx];
        if (classScores[classIdx] > maxScore) {
            maxScore = classScores[classIdx];
            predictedClassIndex = parseInt(classIdx); // Asegura que el índice sea un número.
        }
    }

    // Calcula las "probabilidades" normalizando las puntuaciones de clase.
    const probabilities = [0, 0, 0];
    if (totalScore > 0) {
        probabilities[0] = classScores[0] / totalScore;
        probabilities[1] = classScores[1] / totalScore;
        probabilities[2] = classScores[2] / totalScore;
    } else {
        // Si ninguna regla se activó (totalScore es 0), lo que podría pasar si los inputs
        // están muy lejos de cualquier rango de pertenencia. En este caso, asignamos
        // probabilidades iguales a todas las clases y por defecto a 'Baja'.
        probabilities[0] = 1/3;
        probabilities[1] = 1/3;
        probabilities[2] = 1/3;
        predictedClassIndex = 0; // Por defecto a 'Baja' si no hay activación fuerte.
    }

    return { predictedClassIndex, probabilities };
}

// ==============================
// 5. Función Principal de Predicción (activada por el botón)
// ==============================

/**
 * Obtiene los valores de entrada del usuario de los campos HTML,
 * realiza la fuzzificación y la inferencia fuzzy, y muestra el resultado.
 */
async function predictQuality() {
    // Asegura que el modelo fuzzy esté cargado antes de intentar predecir.
    if (!fuzzyModel) {
        warningMessageDiv.textContent = 'El modelo aún no se ha cargado. Por favor, espera unos segundos e inténtalo de nuevo.';
        warningMessageDiv.classList.remove('hidden');
        resultDiv.classList.add('hidden');
        return;
    }

    // Limpia cualquier mensaje de advertencia o resultado anterior.
    warningMessageDiv.classList.add('hidden');
    qualityPredictionP.textContent = '';
    probabilityDetailsDiv.textContent = '';
    resultDiv.classList.add('hidden');

    // Obtiene los valores numéricos de los campos de entrada HTML.
    const acidezVal = parseFloat(document.getElementById('acidez').value);
    const cafeinaVal = parseFloat(document.getElementById('cafeina').value);
    const humedadVal = parseFloat(document.getElementById('humedad').value);
    const aromaVal = parseFloat(document.getElementById('aroma').value);

    // Valida que todos los valores obtenidos sean números válidos.
    if (isNaN(acidezVal) || isNaN(cafeinaVal) || isNaN(humedadVal) || isNaN(aromaVal)) {
        warningMessageDiv.textContent = 'Por favor, introduce valores numéricos válidos para todos los campos.';
        warningMessageDiv.classList.remove('hidden');
        return;
    }

    // Fuzzificación: Calcula los grados de pertenencia para cada variable de entrada.
    const inputMemberships = {
        acidez: computeMemberships(acidezVal, 'acidez'),
        cafeina: computeMemberships(cafeinaVal, 'cafeina'),
        humedad: computeMemberships(humedadVal, 'humedad'),
        aroma: computeMemberships(aromaVal, 'aroma')
    };

    // Inferencia Fuzzy: Aplica las reglas y determina la calidad.
    const { predictedClassIndex, probabilities } = fuzzyInference(inputMemberships);
    const predictedQuality = classes[predictedClassIndex]; // Obtiene el nombre de la clase.

    // Muestra los resultados en la interfaz de usuario.
    qualityPredictionP.textContent = predictedQuality;
    probabilityDetailsDiv.innerHTML = `Probabilidades (fuerza agregada): Baja: ${probabilities[0].toFixed(2)}, Media: ${probabilities[1].toFixed(2)}, Alta: ${probabilities[2].toFixed(2)}`;
    resultDiv.classList.remove('hidden'); // Hace visible el área de resultados.
}

// ==============================
// 6. Inicialización de la Aplicación
// ==============================

// Al cargar la página web completamente, deshabilita el botón de predicción
// e inicia la carga del modelo fuzzy.
window.onload = () => {
    predictBtn.disabled = true; // Botón deshabilitado hasta que el modelo esté listo.
    loadFuzzyModel(); // Inicia la carga asíncrona del modelo.
};

// Asigna la función 'predictQuality' al evento 'click' del botón de predicción.
predictBtn.addEventListener('click', predictQuality);
