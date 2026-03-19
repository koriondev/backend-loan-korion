const AuditReport = require('../models/AuditReport');
const Loan = require('../models/Loan');
const mongoose = require('mongoose');

/**
 * Report an audit result (validated or discrepancy)
 */
exports.reportAudit = async (req, res) => {
    try {
        console.log('DEBUG: req.user:', req.user);
        const { loanId, status, systemValuesSnapshot, reportedValues } = req.body;

        if (!loanId || !status || !systemValuesSnapshot) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }

        const auditReport = new AuditReport({
            loanId,
            businessId: req.user.businessId,
            auditedBy: req.user.id,
            status,
            systemValuesSnapshot,
            reportedValues: status === 'discrepancy' ? reportedValues : undefined,
            revisionStatus: 'pending'
        });

        await auditReport.save();

        res.status(201).json({ success: true, auditReport });
    } catch (error) {
        console.error('Error reporting audit:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get loans that haven't been audited yet
 */
exports.getPendingAudits = async (req, res) => {
    try {
        const businessId = req.user.businessId;
        console.log(`DEBUG: getPendingAudits for businessId: ${businessId}`);

        // Find IDs of loans already audited in this business
        const auditedLoanIds = await AuditReport.distinct('loanId', { businessId });
        console.log(`DEBUG: auditedLoanIds count: ${auditedLoanIds.length}`);

        // Find active/overdue loans not in that list
        const pendingLoans = await Loan.find({
            businessId,
            status: { $in: ['active', 'past_due'] },
            _id: { $nin: auditedLoanIds }
        }).populate('clientId', 'name cedula phone');
        console.log(`DEBUG: pendingLoans found: ${pendingLoans.length}`);

        // Total count for progress bar
        const totalAuditableLoans = await Loan.countDocuments({
            businessId,
            status: { $in: ['active', 'past_due'] }
        });
        const validatedCount = auditedLoanIds.length;

        res.json({
            success: true,
            loans: pendingLoans,
            progress: {
                validated: validatedCount,
                total: totalAuditableLoans
            }
        });
    } catch (error) {
        console.error('Error fetching pending audits:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get all reports with discrepancies for admin review
 */
exports.getDiscrepancies = async (req, res) => {
    try {
        const businessId = req.user.businessId;

        const discrepancies = await AuditReport.find({
            businessId,
            status: 'discrepancy',
            revisionStatus: 'pending'
        }).populate({
            path: 'loanId',
            populate: { path: 'clientId', select: 'name cedula' }
        }).populate('auditedBy', 'name');

        res.json({ success: true, discrepancies });
    } catch (error) {
        console.error('Error fetching discrepancies:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Mark a discrepancy as corrected
 */
exports.markAsCorrected = async (req, res) => {
    try {
        const { id } = req.params;
        const report = await AuditReport.findOneAndUpdate(
            { _id: id, businessId: req.user.businessId },
            { revisionStatus: 'corrected', updatedAt: new Date() },
            { new: true }
        );

        if (!report) {
            return res.status(404).json({ success: false, error: 'Reporte no encontrado' });
        }

        res.json({ success: true, report });
    } catch (error) {
        console.error('Error marking as corrected:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
