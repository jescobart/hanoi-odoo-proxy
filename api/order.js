export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ODOO_URL = 'https://hanoishushi.odoo.com';
    const ODOO_DB = 'hanoishushi';
    const ODOO_API_KEY = '40555142d8e5d11314139e1cd13f85a8438b0d66';

    try {
        const orderData = req.body;
        console.log('📦 Pedido:', orderData.orderNumber);

        // Autenticar
        const authRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: { db: ODOO_DB, login: 'jescobart@utem.cl', password: ODOO_API_KEY },
                id: 1
            })
        });
        
        const authData = await authRes.json();
        if (!authData.result?.uid) {
            return res.status(401).json({ success: false, error: 'Auth failed' });
        }

        const cookie = authRes.headers.get('set-cookie')?.split(';')[0] || '';

        // Crear pedido
        const orderLines = orderData.items.map(item => [0, 0, {
            product_id: 1,
            product_uom_qty: item.quantity,
            price_unit: item.price,
            name: item.name + (item.salsas?.length ? ' + ' + item.salsas.map(s => s.name).join(', ') : '')
        }]);

        if (orderData.deliveryCost > 0) {
            orderLines.push([0, 0, { product_id: 1, product_uom_qty: 1, price_unit: orderData.deliveryCost, name: 'Delivery' }]);
        }

        const notes = `📱 ${orderData.orderNumber}\n👤 ${orderData.customer?.name}\n📞 ${orderData.phone}\n📍 ${orderData.address || 'Retiro'}\n💳 ${orderData.paymentMethod}`;

        const createRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: {
                    model: 'sale.order',
                    method: 'create',
                    args: [{ partner_id: 1, order_line: orderLines, note: notes, client_order_ref: orderData.orderNumber }],
                    kwargs: {}
                },
                id: 2
            })
        });

        const createData = await createRes.json();
        
        if (createData.result) {
            // Confirmar pedido
            await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: { model: 'sale.order', method: 'action_confirm', args: [[createData.result]], kwargs: {} },
                    id: 3
                })
            });

            return res.status(200).json({ success: true, odooOrderId: createData.result });
        }

        return res.status(500).json({ success: false, error: 'Failed to create order' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
