const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Genera un resumen AI basado en estadísticas del negocio.
 * @param {Object} stats - Estadísticas agregadas.
 * @param {Object} config - Configuración AI del negocio (provider, apiKey).
 */
exports.generateSummary = async (stats, config) => {
    if (!config || !config.enabled || !config.apiKey) {
        throw new Error("AI no configurada para este negocio.");
    }

    const prompt = `
Eres un analista financiero dominicano experto en préstamos (tipo "prestamista con visión").
Tu misión es analizar los números de Korion Loan y decirle al dueño "la real situación" de su negocio en lenguaje claro, directo y dominicano.

DATOS REALES DEL NEGOCIO:
- Cartera Total (Lo que hay en la calle + intereses): ${stats.activePortfolio}
- Capital Neto Prestado (Lo que salió del bolsillo): ${stats.activeCapital}
- Beneficios por Cobrar (Intereses): ${stats.activeInterest}
- Ganancia Proyectada Total: ${stats.projectedProfit}
- Cuánto hay en caja para prestar: ${stats.availableCapital}
- Lo que se cobró este mes: ${stats.collectedMonth}
- Lo que se prestó nuevo este mes: ${stats.lentMonth}
- Préstamos en Mora (Atrasados): ${stats.lateLoans}

REQUISITOS DEL REPORTE:
1. Sé MUY directo. Empieza con la situación real de una vez.
2. Usa lenguaje de prestamista dominicano: "dinero en la calle", "beneficios", "mora", "caja", "solidez".
3. **MÁXIMA PRIORIDAD**: TODOS los montos de dinero deben ir en negrita sin excepción (ej: **${stats.activePortfolio}**). 
4. Si hay **${stats.lateLoans}** préstamos en mora, háblale claro sobre el riesgo. ¿Está la calle pesada o se puede seguir prestando?
5. El reporte debe ser de máximo 5-6 líneas y usar formato Markdown para que las negritas funcionen.
6. Especifica claramente cuánto hay prestado y cuánto dinero se está ganando.
`;

    if (config.provider === 'openai') {
        const openai = new OpenAI({ apiKey: config.apiKey });
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 250,
        });
        return response.choices[0].message.content.trim();
    } else if (config.provider === 'gemini') {
        const genAI = new GoogleGenerativeAI(config.apiKey);

        // Intentar modelos en orden de preferencia
        const modelsToTry = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-pro"];
        let lastError = null;

        for (const modelName of modelsToTry) {
            try {
                // Probamos con v1 explícitamente si es necesario
                const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1' });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text().trim();
            } catch (err) {
                lastError = err;
                // Si el error es 404 (Modelo no encontrado), intentamos el siguiente
                if (err.status === 404 || (err.message && err.message.includes("not found"))) {
                    console.log(`⚠️ Modelo ${modelName} no disponible, probando el siguiente...`);
                    continue;
                }
                // Si es un error de cuota (429), lo reportamos directamente
                if (err.status === 429) {
                    throw new Error("Límite de cuota excedido para Gemini. Por favor, espera un momento o revisa tu plan en Google AI Studio.");
                }
                throw err;
            }
        }
        throw lastError;
    } else {
        throw new Error("Proveedor de AI no soportado.");
    }
};
