const Business = require('../models/Business');
const Loan = require('../models/Loan');

/**
 * Servicio para gestionar la secuencia de mensajes de WhatsApp para prospectos Demo
 */
exports.processTrialSequence = async () => {
    console.log('📱 Procesando secuencia de WhatsApp para Demos...');

    try {
        const demoBusinesses = await Business.find({ isDemo: true, status: 'active' });
        const now = new Date();

        for (const business of demoBusinesses) {
            const createdAt = new Date(business.createdAt);
            const diffTime = Math.abs(now - createdAt);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            console.log(`Business ${business.name}: Día ${diffDays} de prueba.`);

            switch (diffDays) {
                case 0:
                    // Día 0: Bienvenida (Ya debería haberse enviado al registrarse, pero por si acaso)
                    await this.sendTrialMessage(business, 'DAY_0_WELCOME');
                    break;

                case 1:
                case 2:
                    // Día 1-2: Recordatorio si no hay préstamos
                    const loanCount = await this.getLoanCount(business._id);
                    if (loanCount === 0) {
                        await this.sendTrialMessage(business, 'DAY_1_2_REMINDER');
                    }
                    break;

                case 3:
                    // Día 3: Prueba Social
                    await this.sendTrialMessage(business, 'DAY_3_SOCIAL_PROOF');
                    break;

                case 4:
                    // Día 4: Urgencia (24h)
                    await this.sendTrialMessage(business, 'DAY_4_URGENCY');
                    break;

                case 5:
                    // Día 5: Expiración
                    await this.sendTrialMessage(business, 'DAY_5_EXPIRATION');
                    break;
            }
        }
    } catch (error) {
        console.error('❌ Error en processTrialSequence:', error);
    }
};

exports.getLoanCount = async (businessId) => {
    return await Loan.countDocuments({ businessId });
};

exports.sendTrialMessage = async (business, templateKey) => {
    // Aquí se integraría con la API real (Twilio, Meta, etc.)
    // De momento simulamos el log para preparación
    console.log(`📤 [WHATSAPP HOOK] Enviando plantilla ${templateKey} a ${business.ownerEmail} (${business.phone || 'Sin Teléfono'})`);

    // Podríamos guardar una notificación en la DB para registro
};
