const normalizeDate = (d) => {
    const dObj = new Date(d);
    return new Date(Date.UTC(dObj.getFullYear(), dObj.getMonth(), dObj.getDate(), 12, 0, 0, 0));
};

const d1 = new Date('2025-12-16T00:00:00.000Z'); // dueDate
const d2 = new Date(); // refDay

console.log("Local time due date:", d1.toString());
console.log("Local time now:", d2.toString());

const startOfToday = normalizeDate(d2);
const graceDeadline = normalizeDate(d1);

console.log("Normalized due date:", graceDeadline.toUTCString());
console.log("Normalized now:", startOfToday.toUTCString());

const diffTime = Math.abs(startOfToday.getTime() - graceDeadline.getTime());
const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
console.log("diffDays:", diffDays);
