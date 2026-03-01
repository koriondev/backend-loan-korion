const PDFDocument = require('pdfkit');

// 1. Optimización: Instancia Global de Intl para mejor rendimiento
const currencyFormatter = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
const formatCurrency = (amount) => currencyFormatter.format(amount ?? 0);

exports.generateReceiptPDF = (transaction, client, loan, settings) => {
    return new Promise((resolve, reject) => {
        try {
            // 1. Optimización: Uso de bufferPages para rendimiento de memoria
            const doc = new PDFDocument({
                size: [226, 600], // 80mm width approx 226pt. Height variable, set enough.
                margins: { top: 20, bottom: 20, left: 10, right: 10 },
                bufferPages: true
            });

            // 1. Optimización: Captura de errores de Stream
            doc.on('error', reject);

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // 3. Mejoras de Diseño: Helper para tipografía y centralización
            const setFont = (type = 'regular', size = 8) => {
                doc.font(type === 'bold' ? 'Courier-Bold' : 'Courier').fontSize(size);
            };

            setFont('bold', 10);
            const centerX = 113; 
            const maxWidth = 206; // 226 - margins (10*2)

            // --- HEADER ---
            // 2. Limpieza: Nullish Coalescing (??)
            const companyName = settings?.companyName ?? 'KORIONLOAN';
            doc.text(`(${companyName})`, { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            setFont('regular', 8);
            if (settings?.address) {
                // Courier WinAnsiEncoding handles most accents like EN, ES correctly.
                doc.text(settings.address.toUpperCase(), { align: 'center', width: maxWidth });
            }
            if (settings?.phone) {
                doc.text(settings.phone, { align: 'center', width: maxWidth });
            }

            doc.moveDown(0.5);
            doc.text("***ORIGINAL***", { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            setFont('bold', 10);
            doc.text("RECIBO DE PAGO", { align: 'center', width: maxWidth });
            doc.text("==================================", { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            // --- CLIENT INFO ---
            setFont('regular', 8);

            // 2 y 3. Limpieza y Diseño: Función Helper drawRow con coordenadas específicas
            const drawRow = (label, value, isBold = false) => {
                setFont(isBold ? 'bold' : 'regular', 8);
                const startY = doc.y;
                // Ancho distribuido para evitar solapamientos y dar alineación correcta a la derecha
                doc.text(label, 10, startY, { width: 106, align: 'left' });
                doc.text(value, 116, startY, { width: 100, align: 'right' });
                doc.x = 10; // Restaurar cursor horizontal al margen izquierdo
            };

            if (client?.cedula) doc.text(`Ident: ${client.cedula}`, { align: 'center', width: maxWidth });
            doc.text(`Cliente: ${client?.name?.toUpperCase() ?? 'N/A'}`, { align: 'center', width: maxWidth });
            if (client?.phone) doc.text(`Celular: ${client.phone}`, { align: 'center', width: maxWidth });

            doc.moveDown(0.5);
            doc.text("__________________________________", { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            // --- LOAN INFO ---
            const loanIdClean = loan?._id ? loan._id.toString().slice(-6).toUpperCase() : 'N/A';
            const paidQuotas = (loan?.schedule ?? []).filter(q => q.status === 'paid').length;
            const totalQuotas = (loan?.schedule ?? []).length;

            doc.text(`Prest: ${loanIdClean}`, { align: 'center', width: maxWidth });
            doc.text(`Fecha: ${new Date(transaction?.date ?? new Date()).toLocaleString('es-DO')}`, { align: 'center', width: maxWidth });
            doc.text(`Monto: ${formatCurrency(loan?.amount ?? 0)}`, { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            doc.text(`Cuotas: ${paidQuotas} / ${totalQuotas}`, { align: 'center', width: maxWidth });
            doc.text(`Tipo: ${transaction?.category ?? 'Pago Préstamo'}`, { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            // --- BALANCES ---
            const montoPagado = Number(transaction?.amount ?? 0);
            const saldoFinal = loan?.balance ?? loan?.currentCapital ?? 0;
            const saldoInicial = saldoFinal + montoPagado;

            drawRow("S. Inicial:", formatCurrency(saldoInicial));
            doc.moveDown(0.5);

            // --- BREAKDOWN ---
            // 4. Lógica de negocio robusta vs cambios de Schema
            const b = transaction?.metadata?.breakdown ?? transaction?.breakdown ?? {};
            
            // Priorizamos los datos más precisos del breakdown y caemos a root level vars
            const capital = b.appliedToCapital ?? b.capital ?? transaction?.appliedCapital ?? 0;
            const interest = b.appliedToInterest ?? b.interest ?? transaction?.appliedInterest ?? 0;
            const mora = b.appliedToMora ?? b.mora ?? transaction?.appliedPenalty ?? 0;
            const otros = transaction?.otherCharges ?? b.otherCharges ?? 0;

            drawRow("Capital:", formatCurrency(capital));
            drawRow("Interes:", formatCurrency(interest));
            drawRow("Mora:", formatCurrency(mora));
            
            if (otros > 0) {
                drawRow("Otros Cargos:", formatCurrency(otros));
            }

            // Restauramos explícitamente el x para la línea separadora
            doc.x = 10;
            doc.text("________________", { align: 'right', width: maxWidth });
            doc.moveDown(0.5);

            drawRow("Total:", formatCurrency(montoPagado), true);
            doc.moveDown(0.5);

            drawRow("S. Final:", formatCurrency(saldoFinal));
            doc.moveDown(0.5);

            // Reset y Footer
            doc.x = 10;
            doc.text(`Forma Pago: Efectivo`, { align: 'center', width: maxWidth });
            doc.text("__________________________________", { align: 'center', width: maxWidth });
            doc.moveDown(0.5);

            // --- FOOTER ---
            const footerText = settings?.receiptFooter ?? "Sin recibo no hay reclamos.";
            doc.text(footerText, { align: 'center', width: maxWidth });
            doc.moveDown(1);

            doc.text("Att. La Adm.", { align: 'right', width: maxWidth });
            doc.moveDown(0.5);
            doc.text("***ORIGINAL***", { align: 'center', width: maxWidth });

            doc.text(`Impreso: ${new Date().toLocaleString('es-DO')}`, { align: 'center', width: maxWidth });
            doc.text(".", { align: 'left', width: maxWidth }); // End marker

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};
