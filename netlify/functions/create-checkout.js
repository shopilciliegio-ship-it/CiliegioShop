exports.handler = async (event) => {
  console.log('HELLO FROM CREATE-CHECKOUT');
  console.log('Method:', event.httpMethod);
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: 'ok', received: event.body })
  };
};
 