import React, { useState, useEffect } from 'react';
import axios from 'axios';

const Chat = () => {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState(null);

  // Create a new thread when the component is mounted
  useEffect(() => {
    const createThread = async () => {
      try {
        const response = await axios.get('http://localhost:3000/thread');
        setThreadId(response.data.threadId);
      } catch (error) {
        console.error('Error creating thread:', error);
      }
    };
    createThread();

    // Initialize the SpeechRecognition API if it's available
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const recognitionInstance = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognitionInstance.lang = 'en-US';
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;

      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setMessage(transcript); // Update the message state with the transcribed speech
      };

      recognitionInstance.onspeechend = () => {
        recognitionInstance.stop();
        setIsRecording(false); // Stop recording when the user stops speaking
      };

      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      setRecognition(recognitionInstance);
    } else {
      console.error('SpeechRecognition API is not supported in this browser');
    }
  }, []);



const sendMessage = async () => {
  
  if (!message || !threadId) return;
  const newMessages = [...messages, { role: 'user', content: message }];
  setMessages(newMessages);
  setMessage(''); 

  const newMessage = {
    message, 
    threadId, 
  };

  try {
    const response = await fetch('http://localhost:3000/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newMessage),
    });

    console.log('Response from backend:', response);
   
    let assistantResponse = '';  

    const reader = response.body.getReader();  
    const decoder = new TextDecoder();  

    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;

      const chunk = decoder.decode(value, { stream: true });  

      if (chunk) {
        console.log('Partial AI response:', chunk);
        assistantResponse += chunk;  

        const updatedMessages = [
          ...newMessages,
          { role: 'assistant', content: assistantResponse }, 
        ];

        setMessages(updatedMessages); 
      }
    }
    console.log('Stream finished.');
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

const handleRecordClick = () => {
    if (isRecording) {
      recognition.stop();
    } else {
      recognition.start();
      setIsRecording(true);
    }
  };

  return (
    <div style={styles.chatContainer}>
      <div style={styles.messagesContainer}>
        {messages.map((msg, index) => (
          <div
            key={index}
            style={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}
          >
            <strong>{msg.role === 'user' ? 'You' : 'Assistant'}: </strong>
            {msg.content}
          </div>
        ))}
        
      </div>
      <div style={styles.inputContainer}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          style={styles.inputField}
        />
        <button onClick={sendMessage} style={styles.sendButton}>Send</button>
        <button
          onClick={handleRecordClick}
          style={isRecording ? { ...styles.recordButton, backgroundColor: 'red' } : styles.recordButton}
        >
          {isRecording ? 'Stop Recording' : 'Record'}
        </button>
      </div>
    </div>
  );
};

// Styles
const styles = {
  chatContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '85vh',
    maxWidth: '700px',
    margin: 'auto',
    marginTop: '30px',
    padding: '10px',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: '10px',
    marginBottom: '10px',
  },
  userMessage: {
    textAlign: 'right',
    backgroundColor: '#daf8e3',
    padding: '8px',
    borderRadius: '10px',
    marginBottom: '8px',
  },
  assistantMessage: {
    textAlign: 'left',
    backgroundColor: '#e0e0e0',
    padding: '8px',
    borderRadius: '10px',
    marginBottom: '8px',
  },
  inputContainer: {
    display: 'flex',
    alignItems: 'center',
    paddingTop: '10px',
  },
  inputField: {
    flex: 1,
    padding: '10px',
    borderRadius: '5px',
    border: '1px solid #ccc',
    fontSize: '16px',
  },
  sendButton: {
    padding: '10px 20px',
    marginLeft: '10px',
    borderRadius: '5px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
  },
  recordButton: {
    padding: '10px 20px',
    marginLeft: '10px',
    borderRadius: '5px',
    backgroundColor: '#FF6347', // Default color
    color: 'white',
    border: 'none',
    cursor: 'pointer',
  },
};

export default Chat;
