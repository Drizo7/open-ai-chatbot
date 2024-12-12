require('dotenv').config({ path: '../.env' });
const OpenAI = require('openai');
const express = require('express');
const cors = require('cors');
const { OPENAI_API_KEY } = process.env;
const { ASSISTANT_ID } = process.env;
const app = express();
const { google } = require('googleapis');
const path = require('path');

app.use(express.json()); 

app.use(cors());
// Set up OpenAI Client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// Assistant can be created via API or UI
const assistantId = ASSISTANT_ID;

function getFormattedTimestamp() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(now); // Returns formatted date like '12/04/2024 14:30:00'
}

async function addNoteToGoogleSheets(title, body, timestamp) {
  try {
    console.log('addNoteToGoogleSheets called with:', { title, body, timestamp });

    const auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(__dirname, './google-sheet.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    console.log('Authenticating...');
    const client = await auth.getClient();
    console.log('Authentication successful.');

    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = '1_oxngyzfMqujU3r2aFE730wCEUA1IlyBKqgXCjnPuNs';

    console.log('Checking for headers...');
    // Check if the headers exist; if not, add them
    const readResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet2!A1:C1', // Read headers from columns A, B, C
    });

    const headers = readResponse.data.values ? readResponse.data.values[0] : [];
    
    if (headers.length === 0 || headers[0] !== 'Title' || headers[1] !== 'Body' || headers[2] !== 'Timestamp') {
      console.log('Headers not found or incomplete, adding headers...');
      // Set the headers if they are missing
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet2!A1',
        valueInputOption: 'RAW',
        resource: {
          values: [['Title', 'Body', 'Timestamp']], // Add headers to A1:C1
        },
      });
    }

    console.log('Appending data to Google Sheets...');
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet2!A2', // Start appending from row 2 to avoid overwriting headers
      valueInputOption: 'RAW',
      resource: {
        values: [[title, body, timestamp]], // Append the note data
      },
    });

    console.log('Data appended successfully:', appendResponse.data);
  } catch (error) {
    console.error('Error in addNoteToGoogleSheets:', error);
    throw error; // Rethrow the error to handle it higher up if needed
  }
}

// Set up a Thread
async function createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
}

// Add a Message
async function addMessage(threadId, message) {
    console.log('Adding a new message to thread: ' + threadId);
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
}

// Backend streaming logic
let pendingFunctionCall = null; // Store pending function calls for confirmation

async function runStream(threadId, res, userMessage) {
  console.log('Running assistant for thread: ' + threadId);
  console.log('User message:', userMessage);

  let assistantResponse = '';
  let isFunctionCall = false;
  const chunks = []; // Array to collect streamed chunks

  try {
    console.log('Initiating assistant run with streaming enabled...');
    const stream = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: userMessage },
      ],
      functions: [
        {
          name: "createAndPushNote",
          description: "Creates a note and pushes it to Google Sheets",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "The note title" },
              body: { type: "string", description: "The note body" },
            },
            required: ["title", "body"],
          },
        },
      ],
      function_call: "auto",
      stream: true,
      user: threadId,
    });

    console.log('Assistant stream started...');

    for await (const event of stream) {
      console.log('Stream Event:', JSON.stringify(event, null, 2)); 
      if (event.choices && event.choices[0]) {
        const { delta } = event.choices[0];

        if (delta && delta.function_call) {
            console.log('Function Call Detected:', JSON.stringify(delta.function_call, null, 2));
            isFunctionCall = true;

            const functionArguments = delta.function_call.arguments || '';
            chunks.push(functionArguments); 

        } else if (delta && delta.content) {
          console.log('Delta Content:', delta.content);
          assistantResponse += delta.content;
          res.write(delta.content);
        }
      }
    }

    if (isFunctionCall && chunks.length > 0) {
      try {
        const fullArgs = chunks.join(''); 
        const parsedArgs = JSON.parse(fullArgs); 
        console.log('Function Arguments:', parsedArgs);

        const { title, body } = parsedArgs;

        // Check if both title and body are present
        if (!title || !body) {
          // If either is missing, don't call the function and ask for more details
          res.write('Please provide both a title and a body for the note.');
          return; // Stop further execution
        }

        const timestamp = getFormattedTimestamp(); 

        // Only call the function if both title and body are valid
        await addNoteToGoogleSheets(title, body, timestamp);

        res.write(
            `A note with the title "${title}" was created successfully and added to Google Sheets.`
        );
      } catch (error) {
        console.error('Error parsing arguments:', error);
        res.write('Error while processing the function call.');
      }
    } else {
      // If no function call detected, handle it accordingly
      res.write('Please provide a valid request for note creation.');
    }

    res.end();
  } catch (error) {
    console.error('Error in streaming assistant response:', error);
    res.status(500).json({ error: 'Error processing assistant stream.' });
  }
}


//=========================================================
//============== ROUTE SERVER =============================
//=========================================================

// Open a new thread
app.get('/thread', (req, res) => {
    createThread().then(thread => {
        res.json({ threadId: thread.id });
    }).catch(error => {
        console.error("Error creating thread:", error);
        res.status(500).json({ error: 'Error creating thread.' });
    });
});

// Send message and get assistant's response (Streaming)
app.post('/message', (req, res) => {
    const { message, threadId } = req.body;

    if (!message || !threadId) {
        return res.status(400).json({ error: 'Missing message or threadId.' });
    }

    addMessage(threadId, message)
        .then(() => {
            runStream(threadId, res, message);
        })
        .catch(error => {
            console.error("Error adding message:", error);
            res.status(500).json({ error: 'Error adding message.' });
        });
});


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
