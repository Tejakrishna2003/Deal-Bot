require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Facebook = require('facebook-node-sdk');
const { IgApiClient } = require('instagram-private-api');
const schedule = require('node-schedule');

const app = express();
const port = process.env.PORT || 3000;

// Telegram Bot Setup (without polling)
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

// Set webhook
const webhookUrl = 'https://your-ngrok-url.ngrok-free.app/webhook'; // Replace with your ngrok URL
bot.setWebHook(webhookUrl);

// Facebook Setup
const fb = new Facebook({ appId: 'your-app-id', secret: 'your-app-secret' });
fb.setAccessToken(process.env.FB_ACCESS_TOKEN);

// Instagram Setup
const ig = new IgApiClient();
ig.state.generateDevice(process.env.IG_USERNAME);

// Store deals for the dashboard
let deals = [];
let postQueue = [];

// Middleware
app.use(express.json());

// Webhook endpoint for Telegram
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Telegram Message Handler
bot.on('message', async (msg) => {
  try {
    const text = msg.text || '';
    const photo = msg.photo;

    const amazonRegex = /(https?:\/\/(?:www\.)?(amazon\.com|amzn\.to)[^\s]+)/g;
    const linkMatch = text.match(amazonRegex);
    if (!linkMatch) return;

    const amazonLink = linkMatch[0];
    const lines = text.split('\n');
    const productName = lines[0].replace(/🔥/g, '').trim();
    const priceMatch = text.match(/Deal Price\s*:\s*₹\s*(\d+)/);
    const price = priceMatch ? `₹${priceMatch[1]}` : 'Price not found';

    const fullLink = await resolveShortLink(amazonLink);
    const affiliateLink = convertToAffiliate(fullLink);

    const deal = {
      productName,
      price,
      affiliateLink,
      image: photo ? photo[photo.length - 1].file_id : null,
    };
    deals.push(deal);
    postQueue.push(deal);
  } catch (error) {
    console.error('Error processing message:', error.message);
  }
});

// Rest of your server.js code (resolveShortLink, convertToAffiliate, postToSocialMedia, etc.)
async function resolveShortLink(shortLink) {
  try {
    const response = await axios.head(shortLink, { maxRedirects: 10 });
    return response.request.res.responseUrl;
  } catch (error) {
    console.error('Error resolving link:', error.message);
    return shortLink;
  }
}

function convertToAffiliate(link) {
  const tag = process.env.AMAZON_AFFILIATE_TAG;
  if (!link.includes('tag=')) {
    return `${link}?tag=${tag}`;
  }
  return link;
}

async function postToSocialMedia(deal) {
  const { productName, price, affiliateLink, image } = deal;
  try {
    fb.api('/me/feed', 'POST', {
      message: `${productName}\nPrice: ${price}\nCheck out this deal: ${affiliateLink}`,
      link: affiliateLink,
    }, (res) => {
      if (!res || res.error) {
        console.error('FB Error:', res?.error || 'Unknown');
      } else {
        console.log('Posted to Facebook:', affiliateLink);
      }
    });

    await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
    let imageBuffer = null;
    if (image) {
      const fileLink = await bot.getFileLink(image);
      const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(response.data);
    }

    if (imageBuffer) {
      await ig.publish.photo({
        file: imageBuffer,
        caption: `${productName}\nPrice: ${price}\nLink in bio!`,
      });
      console.log('Posted to Instagram:', affiliateLink);
      await ig.account.editProfile({
        biography: `Latest Deal: ${affiliateLink} 🔥 Check out more deals in my stories!`,
      });
      console.log('Updated Instagram bio with link:', affiliateLink);
    } else {
      console.log('Skipped Instagram - no image available');
    }
  } catch (error) {
    console.error('Social Media Error:', error.message);
  }
}




schedule.scheduleJob('0 * * * *', async () => {
  if (postQueue.length) {
    const deal = postQueue.shift();
    await postToSocialMedia(deal);
  }
});

app.get('/deals', (req, res) => {
  res.json(deals);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});