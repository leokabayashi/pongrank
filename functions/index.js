const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenAI, Type } = require("@google/genai");
const logger = require("firebase-functions/logger");

exports.processMatchResult = onCall({ cors: true, secrets: ["GEMINI_API_KEY"] }, async (request) => {
    const { text, playersList } = request.data;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new HttpsError("failed-precondition", "API Key not configured.");
    }

    if (!text) {
        throw new HttpsError("invalid-argument", "The function must be called with a 'text' argument.");
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const currentDate = new Date().toLocaleString('pt-BR');

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Analise este texto de resultado de tênis de mesa: "${text}".
        
        Contexto:
        - Data/Hora atual: ${currentDate}
        - Lista de Jogadores Registrados:
        ${playersList}

        Instruções:
        1. Identifique dois jogadores da lista acima. O texto pode usar o Nome Completo ou qualquer um dos Apelidos.
        2. IMPORTANTE: Se o nome ouvido soar parecido com um nome ou apelido da lista, faça a correção fonética (ex: "Cuba" -> "Koba", "Vini" -> "Vinicius"). O reconhecimento de voz pode errar a grafia.
        3. Identifique os placares. Formatos comuns: "3 a 1", "3-1", "3 1".
           - Se o formato for "Jogador A e Jogador B 3-1", assuma Score A = 3, Score B = 1.
        4. Mapeie os nomes encontrados para o "Nome Completo" exato da lista.
        5. Se houver menção de data ou hora (ex: "ontem", "hoje às 14h", "sexta passada"), calcule a data ISO 8601 aproximada baseada na data atual. Se não houver, retorne null.
        
        Retorne JSON:
        { 
          "valid": boolean, 
          "player1": "Nome Completo", 
          "score1": number, 
          "player2": "Nome Completo", 
          "score2": number,
          "matchDate": "ISO8601 String ou null"
        }
        
        - Se não encontrar jogadores correspondentes na lista, valid = false.
        - Se faltar placar, valid = false.
        `,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        valid: { type: Type.BOOLEAN },
                        player1: { type: Type.STRING },
                        score1: { type: Type.NUMBER },
                        player2: { type: Type.STRING },
                        score2: { type: Type.NUMBER },
                        matchDate: { type: Type.STRING, nullable: true },
                    }
                }
            }
        });

        const result = JSON.parse(response.text());
        return result;

    } catch (error) {
        logger.error("Error calling Gemini:", error);
        throw new HttpsError("internal", "Error processing with Gemini.", error.message);
    }
});
