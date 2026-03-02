const fetch = require('node-fetch');

async function test() {
    try {
        const res = await fetch('http://localhost:5000/api/loans');
        const data = await res.json();
        console.log("Loans:", data.length);
    } catch(e) {
        console.error(e);
    }
}
test();
