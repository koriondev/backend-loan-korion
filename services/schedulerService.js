const cron = require('node-cron');
const Settings = require('../models/Settings');
const Loan = require('../models/Loan');
const penaltyEngine = require('../engines/penaltyEngine');
const notificationController = require('../controllers/notificationController');
// const whatsappService = require('./whatsappService'); // Service not yet operational

const initScheduler = () => {
    console.log('⏰ Scheduler Service Initialized');

    // 1. RECALCULO FINANCIERO DIARIO (00:01 AM)
    // Runs at 12:01 AM every day to update overdue statuses and penalties
    cron.schedule('1 0 * * *', async () => {
        console.log('🚀 [EC2] Iniciando recálculo financiero diario de préstamos...');
        try {
            const activeLoans = await Loan.find({
                status: { $in: ['active', 'past_due'] }
            });

            console.log(`📊 Procesando ${activeLoans.length} préstamos para actualización de mora...`);

            let updatedCount = 0;
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            for (const loan of activeLoans) {
                try {
                    const settings = await Settings.findOne({ businessId: loan.businessId });
                    const penaltyData = penaltyEngine.calculatePenaltyV3(loan, settings);

                    if (penaltyData.periodsOverdue > 0 || loan.status === 'past_due') {
                        // GT Consumption Logic: Lógica de Seguro de Tiempo
                        const paidGTs = (loan.schedule || []).filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;

                        const allOverdue = (loan.schedule || []).filter(q => {
                            if (q.status === 'paid') return false;
                            const dueDate = new Date(q.dueDate);
                            return dueDate < now;
                        });

                        // Consumimos los atrasos más antiguos con los pagos de GT que tengamos.
                        const overdueInstallments = allOverdue.slice(paidGTs);

                        let daysLate = 0;
                        if (overdueInstallments.length > 0) {
                            const firstOverdue = overdueInstallments[0];
                            const diffTime = Math.abs(now - new Date(firstOverdue.dueDate));
                            daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        }

                        // Determinar estado final
                        loan.status = overdueInstallments.length > 0 ? 'past_due' : 'active';
                        loan.daysLate = daysLate;
                        loan.installmentsOverdue = overdueInstallments.length;
                        loan.pendingPenalty = penaltyData.totalPenalty;

                        await loan.save({ validateBeforeSave: false });
                        updatedCount++;
                    } else if (loan.status === 'past_due' && penaltyData.periodsOverdue === 0) {
                        // Retornar a "Al día" si ya no hay mora
                        loan.status = 'active';
                        loan.daysLate = 0;
                        loan.installmentsOverdue = 0;
                        loan.pendingPenalty = 0;
                        await loan.save({ validateBeforeSave: false });
                        updatedCount++;
                    }
                } catch (loanError) {
                    console.error(`❌ Error procesando préstamo ${loan._id}:`, loanError);
                }
            }
            console.log(`✅ [EC2] Recálculo finalizado. ${updatedCount} préstamos actualizados exitosamente.`);
        } catch (error) {
            console.error('❌ Error en Tarea Cron Diaria:', error);
        }
    });

    // 2. SUMARIOS TELEGRAM (Cada minuto)
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

            const settingsList = await Settings.find({
                'telegram.enabled': true,
                'telegram.schedule': currentTime
            });

            if (settingsList.length > 0) {
                console.log(`📢 Enviando resúmenes para ${settingsList.length} negocios a las ${currentTime}`);
                // Bucle asíncrono para evitar bloqueos en el hilo principal
                for (const settings of settingsList) {
                    try {
                        await notificationController.sendSummary(settings.businessId);
                    } catch (notifyError) {
                        console.error(`❌ Error enviando resumen a ${settings.businessId}:`, notifyError);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Scheduler Error (Telegram):', error);
        }
    });

    // 3. WHATSAPP TRIAL SEQUENCE (DESACTIVADO)
    /*
    cron.schedule('0 9 * * *', async () => {
        try {
            await whatsappService.processTrialSequence();
        } catch (error) {
            console.error('❌ WhatsApp Scheduler Error:', error);
        }
    });
    */
};

module.exports = initScheduler;
