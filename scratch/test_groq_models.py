# scratch/test_groq_models.py
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

models = [
    "llama-3.1-8b-instant",
    "llama3-8b-8192",
    "gemma2-9b-it",
    "mixtral-8x7b-32768"
]

for model in models:
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Hello"}],
            max_tokens=10
        )
        print(f"SUCCESS with model: {model}")
        print(f"Response: {response.choices[0].message.content}\n")
    except Exception as e:
        print(f"FAILED with model: {model} - {e}\n")
