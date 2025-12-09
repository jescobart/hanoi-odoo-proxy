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
        console.log('📦 Pedido recibido:', orderData.orderNumber);

        // 1. Autenticar via XML-RPC
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
        const uidMatch = authText.match(/<int>(\d+)<\/int>/);
        
        if (!uidMatch) {
            console.log('❌ Auth failed:', authText);
            return res.status(401).json({ success: false, error: 'Auth failed' });
        }

        const uid = uidMatch[1];
        console.log('✅ UID:', uid);

        // 2. Buscar o crear cliente
        const customer = orderData.customer || {};
        const customerName = customer.name || 'Cliente Web';
        const customerPhone = customer.phone || orderData.phone || '';
        
        // Buscar cliente existente por teléfono
        const searchPartnerXml = `<?xml version="1.0"?>
        <methodCall>
            <methodName>execute_kw</methodName>
            <params>
                <param><value><string>${ODOO_DB}</string></value></param>
                <param><value><int>${uid}</int></value></param>
                <param><value><string>${ODOO_API_KEY}</string></value></param>
                <param><value><string>res.partner</string></value></param>
                <param><value><string>search</string></value></param>
                <param><value><array><data>
                    <value><array><data>
                        <value><array><data>
                            <value><string>phone</string></value>
                            <value><string>=</string></value>
                            <value><string>${customerPhone}</string></value>
                        </data></array></value>
                    </data></array></value>
                </data></array></value></param>
                <param><value><struct>
                    <member><name>limit</name><value><int>1</int></value></member>
                </struct></value></param>
            </params>
        </methodCall>`;

        const searchRes = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: searchPartnerXml
        });
        const searchText = await searchRes.text();
        console.log('🔍 Search partner:', searchText.substring(0, 200));

        let partnerId = null;
        const partnerMatch = searchText.match(/<int>(\d+)<\/int>/);
        
        if (partnerMatch) {
            partnerId = partnerMatch[1];
            console.log('👤 Cliente encontrado:', partnerId);
        } else {
            // Crear nuevo cliente
            const createPartnerXml = `<?xml version="1.0"?>
            <methodCall>
                <methodName>execute_kw</methodName>
                <params>
                    <param><value><string>${ODOO_DB}</string></value></param>
                    <param><value><int>${uid}</int></value></param>
                    <param><value><string>${ODOO_API_KEY}</string></value></param>
                    <param><value><string>res.partner</string></value></param>
                    <param><value><string>create</string></value></param>
                    <param><value><array><data>
                        <value><struct>
                            <member><name>name</name><value><string>${customerName}</string></value></member>
                            <member><name>phone</name><value><string>${customerPhone}</string></value></member>
                            <member><name>street</name><value><string>${customer.address || ''}</string></value></member>
                        </struct></value>
                    </data></array></value></param>
                </params>
            </methodCall>`;

            const createPartnerRes = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml' },
                body: createPartnerXml
            });
            const createPartnerText = await createPartnerRes.text();
            console.log('👤 Create partner:', createPartnerText.substring(0, 200));
            
            const newPartnerMatch = createPartnerText.match(/<int>(\d+)<\/int>/);
            if (newPartnerMatch) {
                partnerId = newPartnerMatch[1];
                console.log('👤 Cliente creado:', partnerId);
            }
        }

        if (!partnerId) {
            // Usar el usuario admin como fallback
            partnerId = uid;
            console.log('⚠️ Usando UID como partner:', partnerId);
        }

        // 3. Preparar nota del pedido
        const items = orderData.items || [];
        const productLines = items.map(item => {
            const name = item.product || item.name || 'Producto';
            const qty = item.quantity || 1;
            const price = item.unitPrice || item.price || 0;
            return `${qty}x ${name} - $${(price * qty).toLocaleString('es-CL')}`;
        }).join('\n');

        const deliveryCost = orderData.delivery?.cost || 0;
        const total = orderData.payment?.total || 0;

        const noteText = `═══════════════════════════
PEDIDO WEB: ${orderData.orderNumber}
═══════════════════════════

CLIENTE: ${customerName}
TELÉFONO: ${customerPhone}
DIRECCIÓN: ${customer.address || 'Retiro en local'}

───────────────────────────
PRODUCTOS:
${productLines}
───────────────────────────
${deliveryCost > 0 ? `DELIVERY: $${deliveryCost.toLocaleString('es-CL')}\n` : ''}TOTAL: $${total.toLocaleString('es-CL')}

PAGO: ${orderData.payment?.method || 'No especificado'}
═══════════════════════════`;

        // 4. Crear líneas de pedido (usando subtotal que incluye salsas)
        const orderLines = items.map(item => {
            const name = item.product || item.name || 'Producto';
            const qty = item.quantity || 1;
            // Usar subtotal/qty para obtener precio unitario con salsas incluidas
            const subtotal = item.subtotal || (item.unitPrice || item.price || 0) * qty;
            const priceWithExtras = subtotal / qty;
            const extras = item.extras ? ` (${item.extras})` : '';
            return `<value><array><data>
                <value><int>0</int></value>
                <value><int>0</int></value>
                <value><struct>
                    <member><name>name</name><value><string>${(name + extras).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</string></value></member>
                    <member><name>product_uom_qty</name><value><double>${qty}</double></value></member>
                    <member><name>price_unit</name><value><double>${priceWithExtras}</double></value></member>
                </struct></value>
            </data></array></value>`;
        }).join('\n');

        // Agregar línea de delivery si existe
        let deliveryLine = '';
        if (deliveryCost > 0) {
            deliveryLine = `<value><array><data>
                <value><int>0</int></value>
                <value><int>0</int></value>
                <value><struct>
                    <member><name>name</name><value><string>Delivery</string></value></member>
                    <member><name>product_uom_qty</name><value><double>1</double></value></member>
                    <member><name>price_unit</name><value><double>${deliveryCost}</double></value></member>
                </struct></value>
            </data></array></value>`;
        }

        // 5. Crear pedido de venta con líneas
        const createOrderXml = `<?xml version="1.0"?>
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
                        <member><name>partner_id</name><value><int>${partnerId}</int></value></member>
                        <member><name>client_order_ref</name><value><string>${orderData.orderNumber}</string></value></member>
                        <member><name>note</name><value><string>Pago: ${orderData.payment?.method || 'No especificado'}</string></value></member>
                        <member><name>order_line</name><value><array><data>
                            ${orderLines}
                            ${deliveryLine}
                        </data></array></value></member>
                    </struct></value>
                </data></array></value></param>
            </params>
        </methodCall>`;

        const createOrderRes = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: createOrderXml
        });

        const createOrderText = await createOrderRes.text();
        console.log('📄 Create order response:', createOrderText);

        // Verificar si hay error
        if (createOrderText.includes('<fault>')) {
            const faultMatch = createOrderText.match(/<string>([\s\S]*?)<\/string>/);
            const errorMsg = faultMatch ? faultMatch[1].substring(0, 200) : 'Unknown error';
            console.log('❌ Error:', errorMsg);
            return res.status(500).json({ success: false, error: errorMsg });
        }

        const orderIdMatch = createOrderText.match(/<int>(\d+)<\/int>/);
        if (orderIdMatch) {
            const orderId = orderIdMatch[1];
            console.log('✅ Pedido creado ID:', orderId);
            
            return res.status(200).json({ 
                success: true, 
                odooOrderId: orderId,
                message: 'Pedido creado en Odoo'
            });
        }

        return res.status(500).json({ success: false, error: 'No order ID returned' });

    } catch (error) {
        console.log('❌ Exception:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}
