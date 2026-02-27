const PDFDocument = require('pdfkit');

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(amount);
};

exports.generateReceiptPDF = (transaction, client, loan, settings) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: [226, 600], // 80mm width approx 226pt. Height variable, set enough.
                margins: { top: 20, bottom: 20, left: 10, right: 10 }
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Font settings
            doc.font('Courier-Bold').fontSize(10);

            const centerX = 113; // 226 / 2
            let y = 20;
            const lineHeight = 12;

            // --- HEADER ---
            const companyName = settings?.companyName || 'KORIONLOAN';
            doc.text(`(${companyName})`, { align: 'center' });
            doc.moveDown(0.5);

            doc.font('Courier').fontSize(8);
            if (settings?.address) {
                doc.text(settings.address.toUpperCase(), { align: 'center' });
            }
            if (settings?.phone) {
                doc.text(settings.phone, { align: 'center' });
            }

            doc.moveDown(0.5);
            doc.text("***ORIGINAL***", { align: 'center' });
            doc.moveDown(0.5);

            doc.font('Courier-Bold').fontSize(10);
            doc.text("RECIBO DE PAGO", { align: 'center' });
            doc.text("==================================", { align: 'center' });
            doc.moveDown(0.5);

            // --- CLIENT INFO ---
            doc.font('Courier').fontSize(8);

            // Helper for rows
            const row = (label, value, bold = false) => {
                if (bold) doc.font('Courier-Bold');
                else doc.font('Courier');

                const startY = doc.y;
                doc.text(label, { continued: true });
                doc.text(value, { align: 'right' });
            };

            if (client.cedula) doc.text(`Ident: ${client.cedula}`, { align: 'center' });
            doc.text(`Cliente: ${client.name.toUpperCase()}`, { align: 'center' });
            if (client.phone) doc.text(`Celular: ${client.phone}`, { align: 'center' });

            doc.moveDown(0.5);
            doc.text("__________________________________", { align: 'center' });
            doc.moveDown(0.5);

            // --- LOAN INFO ---
            const loanIdClean = loan._id.toString().slice(-6).toUpperCase();
            const paidQuotas = loan.schedule.filter(q => q.status === 'paid').length;
            const totalQuotas = loan.schedule.length;

            doc.text(`Prest: ${loanIdClean}`, { align: 'center' });
            doc.text(`Fecha: ${new Date(transaction.date).toLocaleString('es-DO')}`, { align: 'center' });
            doc.text(`Monto: ${formatCurrency(loan.amount)}`, { align: 'center' });
            doc.moveDown(0.5);

            doc.text(`Cuotas: ${paidQuotas} / ${totalQuotas}`, { align: 'center' });
            doc.text(`Tipo: ${transaction.category || 'Pago Préstamo'}`, { align: 'center' });
            doc.moveDown(0.5);

            // --- BALANCES ---
            const montoPagado = Number(transaction.amount);
            const saldoFinal = loan.balance;
            const saldoInicial = saldoFinal + montoPagado;

            row("S. Inicial:", formatCurrency(saldoInicial));
            doc.moveDown(0.5);

            // --- BREAKDOWN ---
            const b = transaction.metadata?.breakdown || transaction.breakdown || { interest: 0, capital: 0, mora: 0 };

            // Handle different metadata structures (appliedTo... vs direct keys)
            const capital = b.appliedToCapital || b.capital || 0;
            const interest = b.appliedToInterest || b.interest || 0;
            const mora = b.appliedToMora || b.mora || 0;
            const otros = transaction.otherCharges || b.otherCharges || 0;

            row("Capital:", formatCurrency(capital));
            row("Interes:", formatCurrency(interest));
            row("Mora:", formatCurrency(mora));
            if (otros > 0) row("Otros Cargos:", formatCurrency(otros));

            doc.text("________________", { align: 'right' });
            doc.moveDown(0.5);

            row("Total:", formatCurrency(montoPagado), true);
            doc.moveDown(0.5);

            row("S. Final:", formatCurrency(saldoFinal));
            doc.moveDown(0.5);

            doc.text(`Forma Pago: Efectivo`, { align: 'center' });
            doc.text("__________________________________", { align: 'center' });
            doc.moveDown(0.5);

            // --- FOOTER ---
            const footerText = settings?.receiptFooter || "Sin recibo no hay reclamos.";
            doc.text(footerText, { align: 'center', width: 200 });
            doc.moveDown(1);

            doc.text("Att. La Adm.", { align: 'right' });
            doc.moveDown(0.5);
            doc.text("***ORIGINAL***", { align: 'center' });

            doc.text(`Impreso: ${new Date().toLocaleString('es-DO')}`, { align: 'center' });
            doc.text(".", { align: 'left' }); // End marker

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};
