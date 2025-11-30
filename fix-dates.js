require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Settings = require('./models/Settings');

// --- LOGIC DUPLICATED FROM CONTROLLER ---
const getNextDate = (startDate, index, freq, settings) => {
    const date = new Date(startDate);
    const daysMap = { 'daily': 1, 'weekly': 7, 'biweekly': 15, 'monthly': 30 };
    const daysToAdd = daysMap[freq] || 7;

    // Calcular fecha base
    date.setDate(date.getDate() + (index * daysToAdd));

    // Ajustar si es día no laborable (si hay settings)
    if (settings && settings.workingDays && settings.workingDays.length > 0) {
        const isWorkingDay = (d) => {
            const dayOfWeek = d.getDay(); // 0-6
            const isDayOff = !settings.workingDays.includes(dayOfWeek);

            // Verificar feriados específicos
            const isHoliday = settings.nonWorkingDates && settings.nonWorkingDates.some(holiday => {
                const h = new Date(holiday);
                return h.getDate() === d.getDate() && h.getMonth() === d.getMonth() && h.getFullYear() === d.getFullYear();
            });

            return !isDayOff && !isHoliday;
        };

        // Si cae en día no laborable, mover al siguiente día hasta encontrar uno laborable
        while (!isWorkingDay(date)) {
            date.setDate(date.getDate() + 1);
        }
    }

    return date;
};

const runMigration = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
        await mongoose.connect(MONGO_URI);
        console.log('🟢 Connected to MongoDB');

        const loans = await Loan.find({});
        console.log(`Found ${loans.length} loans to check.`);

        let updatedCount = 0;

        for (const loan of loans) {
            // Fetch settings for this loan's business
            const settings = await Settings.findOne({ businessId: loan.businessId });

            if (!settings) {
                console.log(`⚠️ No settings found for loan ${loan._id} (Business: ${loan.businessId}). Skipping working days check.`);
                continue;
            }

            let modified = false;
            const startDate = new Date(loan.createdAt);

            // Re-calculate dates for each installment
            loan.schedule.forEach(q => {
                const oldDate = new Date(q.dueDate);
                const newDate = getNextDate(startDate, q.number, loan.frequency, settings);

                // Compare dates (ignoring time)
                if (oldDate.toISOString().split('T')[0] !== newDate.toISOString().split('T')[0]) {
                    console.log(`Loan ${loan._id} - Quota ${q.number}: ${oldDate.toISOString().split('T')[0]} -> ${newDate.toISOString().split('T')[0]}`);
                    q.dueDate = newDate;
                    modified = true;
                }
            });

            if (modified) {
                loan.markModified('schedule');
                await loan.save();
                updatedCount++;
            }
        }

        console.log(`✅ Migration complete. Updated ${updatedCount} loans.`);
        process.exit(0);

    } catch (error) {
        console.error('🔴 Error:', error);
        process.exit(1);
    }
};

runMigration();
