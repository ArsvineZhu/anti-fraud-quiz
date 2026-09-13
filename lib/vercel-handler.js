const { handleApiRequest } = require('./quiz-api');

module.exports = (request, response) => handleApiRequest(request, response, { runtime: 'vercel' });
