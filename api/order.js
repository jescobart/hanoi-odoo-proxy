export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ODOO_URL = 'https://hanoishushi.odoo.com';
    const ODOO_DB = 'hanoishushi';
    const ODOO_USERNAME = 'jescobart@utem.cl';
    const ODOO_API_KEY = '40555142d8e5d11314139e1cd13f85a8438b0d66';

    try {
        // Obtener datos del pedido (puede venir en order o directamente)
        const orderData = req.body.order || req.body;
        console.log('📦 Pedido recibido:', orderData.orderNumber);

        // Autenticar con Odoo
        const authRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: { db: ODOO_DB, login: ODOO_USERNAME, password: ODOO_API_KEY },
                id: 1
            })
        });
        
        const authData = await authRes.json();
        console.log('🔐 Auth response:', authData.result ? 'OK' : 'FAILED');
        
        if (!authData.result?.uid) {
            console.log('❌ Auth error:', JSON.stringify(authData));
            return res.status(401).json({ success: false, error: 'Auth failed', details: authData });
        }

        const cookie = authRes.headers.get('set-cookie')?.split(';')[0] || '';

        // Preparar líneas del pedido
        const items = orderData.items || [];
        const orderLines = items.map(item => [0, 0, {
            product_id: 1,
            product_uom_qty: item.quantity || 1,
            price_unit: item.unitPrice || item.price || 0,
            name: item.product || item.name || 'Producto'
        }]);

        // Agregar delivery si existe
        const deliveryCost = orderData.delivery?.cost || orderData.deliveryCost || 0;
        if (deliveryCost > 0) {
            orderLines.push([0, 0, { 
                product_id: 1, 
                product_uom_qty: 1, 
                price_unit: deliveryCost, 
                name: 'Delivery' 
            }]);
        }

        // Notas del pedido
        const customer = orderData.customer || {};
        const notes = [
            `📱 Pedido: ${orderData.orderNumber || 'N/A'}`,
            `👤 Cliente: ${customer.name || 'N/A'}`,
            `📞 Teléfono: ${customer.phone || orderData.phone || 'N/A'}`,
            `📍 Dirección: ${customer.address || orderData.address || 'Retiro en local'}`,
            `💳 Pago: ${orderData.payment?.method || orderData.paymentMethod || 'N/A'}`,
            `💰 Total: $${orderData.payment?.total || orderData.total || 0}`
        ].join('\n');

        console.log('📝 Creando pedido en Odoo...');

        // Crear pedido en Odoo
        const createRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: {
                    model: 'sale.order',
                    method: 'create',
                    args: [{ 
                        partner_id: 1, 
                        order_line: orderLines, 
                        note: notes, 
                        client_order_ref: orderData.orderNumber || `WEB-${Date.now()}`
                    }],
                    kwargs: {}
                },
                id: 2
            })
        });

        const createData = await createRes.json();
        console.log('📄 Create response:', JSON.stringify(createData));
        
        if (createData.result) {
            console.log('✅ Pedido creado con ID:', createData.result);
            
            // Confirmar pedido
            await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: { 
                        model: 'sale.order', 
                        method: 'action_confirm', 
                        args: [[createData.result]], 
                        kwargs: {} 
                    },
                    id: 3
                })
            });

            return res.status(200).json({ 
                success: true, 
                odooOrderId: createData.result,
                message: 'Pedido creado en Odoo'
            });
        }

        console.log('❌ Error al crear:', JSON.stringify(createData));
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to create order',
            details: createData
        });
    } catch (error) {
        console.log('❌ Exception:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
