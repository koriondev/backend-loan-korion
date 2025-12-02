const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:5000/api';

const checkLoans = async () => {
    try {
        // Login
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: 'duartecoronajeffrynoel@gmail.com',
            password: '123456'
        });
        const token = loginRes.data.token;
        console.log('✅ Token obtenido');

        // Get Loans
        console.log('🔄 Consultando préstamos...');
        const res = await axios.get(`${API_URL}/loans`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log(`✅ Éxito! ${res.data.length} préstamos obtenidos`);
        if (res.data.length > 0) {
            console.log('Muestra del primero:', JSON.stringify(res.data[0], null, 2));
        }

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
        if (error.response?.data) {
            console.error('Status:', error.response.status);
        }
    }
};

checkLoans();
