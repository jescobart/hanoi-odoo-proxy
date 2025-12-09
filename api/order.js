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
        const orderData = req.body.order || req.body;
        console.log('📦 Pedido recibido:', JSON.stringify(orderData));

        // Primero autenticar via XML-RPC
        const authXml = `<?xml version="1.0"?>
        <methodCall>
            <methodName>authenticate</methodName>
            <params>
                <param><value><string>${ODOO_DB}</string></value></param>
                <param><value><string>${ODOO_USERNAME}</string></value></param>
                <param><value><string>${ODOO_API_KEY}</string></value></param>
                <param><value><struct></struct></value></param>
            </params>
        </methodCall>`;

        const authRes = await fetch(`${ODOO_URL}/xmlrpc/2/common`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: authXml
        });

        const authText = await authRes.text();
        console.log('🔐 Auth response:', authText.substring(0, 200));

        // Extraer UID de la respuesta
        const uidMatch = authText.match(/<int>(\d+)<\/int>/);
        if (!uidMatch) {
            return res.status(401).json({ 
                success: false, 
                error: 'Auth failed - no UID returned',
                response: authText.substring(0, 500)
            });
        }

        const uid = uidMatch[1];
        console.log('✅ UID obtenido:', uid);

        // Preparar datos del pedido
        const items = orderData.items || [];
        const customer = orderData.customer || {};
        
        const productLines = items.map(item => {
            const name = item.product || item.name || 'Producto';
            const qty = item.quantity || 1;
            const price = item.unitPrice || item.price || 0;
            return `${qty}x ${name} - $${price * qty}`;
        }).join('\n');

        const deliveryCost = orderData.delivery?.cost || orderData.deliveryCost || 0;
        const total = orderData.payment?.total || orderData.total || 0;

        const noteText = [
            `PEDIDO WEB: ${orderData.orderNumber || 'N/A'}`,
            ``,
            `CLIENTE: ${customer.name || 'N/A'}`,
            `TELEFONO: ${customer.phone || orderData.phone || 'N/A'}`,
            `DIRECCION: ${customer.address || orderData.address || 'Retiro en local'}`,
            ``,
            `PRODUCTOS:`,
            productLines,
            ``,
            deliveryCost > 0 ? `DELIVERY: $${deliveryCost}` : '',
            `TOTAL: $${total}`,
            ``,
            `PAGO: ${orderData.payment?.method || orderData.paymentMethod || 'N/A'}`
        ].filter(Boolean).join('\n');

        // Crear pedido via XML-RPC
        const createXml = `<?xml version="1.0"?>
        <methodCall>
            <methodName>execute_kw</methodName>
            <params>
                <param><value><string>${ODOO_DB}</string></value></param>
                <param><value><int>${uid}</int></value></param>
                <param><value><string>${ODOO_API_KEY}</string></value></param>
                <param><value><string>sale.order</string></value></param>
                <param><value><string>create</string></value></param>
                <param><value><array><data>
                    <value><struct>
                        <member>
                            <name>partner_id</name>
                            <value><int>1</int></value>
                        </member>
                        <member>
                            <name>note</name>
                            <value><string>${noteText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string></value>
                        </member>
                        <member>
                            <name>client_order_ref</name>
                            <value><string>${orderData.orderNumber || 'WEB-' + Date.now()}</string></value>
                        </member>
                    </struct>
                </data></array></value></param>
            </params>
        </methodCall>`;

        const createRes = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: createXml
        });

        const createText = await createRes.text();
        console.log('📄 Create response:', createText.substring(0, 300));

        const orderIdMatch = createText.match(/<int>(\d+)<\/int>/);
        if (orderIdMatch) {
            const orderId = orderIdMatch[1];
            console.log('✅ Pedido creado:', orderId);
            
            return res.status(200).json({ 
                success: true, 
                odooOrderId: orderId,
                message: 'Pedido creado en Odoo'
            });
        }

        return res.status(500).json({ 
            success: false, 
            error: 'No se pudo crear el pedido',
            response: createText.substring(0, 500)
        });

    } catch (error) {
        console.log('❌ Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
