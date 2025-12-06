const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const SECRET = 'korion_secret_key_123'; // Hardcoded from authMiddleware.js
const API_URL = 'http://localhost:5000/api/clients';

// User details from previous step (will fill in after seeing output)
const userId = 'USER_ID_PLACEHOLDER';
const businessId = 'BUSINESS_ID_PLACEHOLDER';
const role = 'admin'; // or whatever

const token = jwt.sign({ id: userId, role, businessId }, SECRET);

console.log('Generated Token:', token);

async function testApi() {
    try {
        const res = await axios.get(API_URL, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('API Response Status:', res.status);
        console.log('Clients found:', res.data.length);
        if (res.data.length > 0) {
            console.log('First client:', res.data[0]);
        }
    } catch (error) {
        console.error('API Error:', error.response ? error.response.data : error.message);
    }
}

testApi();
