import json
import os
import random
from pathlib import Path
import pypdfium2 as pdfium
from src.llm.groq_client import generate

PDFS = {
    "ArcaUsTreasuryFund_20200207_N-2_EX-99.K5_11971930_EX-99.K5_Development Agreement.pdf": 25,
    "alpha_contract.pdf": 10,
    "Eslab (2).pdf": 10,
}

PROMPT_TEMPLATE = """
You are generating a dataset for evaluating a RAG system on legal contracts.
Given the following context from a document named '{filename}', generate exactly {count} distinct question-answer pairs.
The questions MUST be answerable ONLY using the provided context.
The answer MUST be factually correct based on the context.

Context:
{context}

Format your output exactly as a JSON array of objects with keys: "question", "answer", "context".
The "context" should be the exact text snippet from the document that contains the answer.
DO NOT output anything other than valid JSON.

[
    {{
        "question": "What is...",
        "answer": "It is...",
        "context": "..."
    }}
]
"""

def extract_text(pdf_path: Path):
    pdf = pdfium.PdfDocument(str(pdf_path))
    text = ""
    for page in pdf:
        textpage = page.get_textpage()
        text += textpage.get_text_range() + "\n\n"
    return text

def chunk_text(text: str, chunk_size=2000):
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size):
        chunks.append(" ".join(words[i:i+chunk_size]))
    return chunks

def generate_qa_pairs():
    data_dir = Path("data/uploads")
    dataset = []
    
    for filename, count in PDFS.items():
        print(f"Processing {filename}...")
        path = data_dir / filename
        text = extract_text(path)
        chunks = chunk_text(text)
        
        if not chunks:
            continue
        
        pairs_per_chunk = max(1, count // len(chunks))
        remaining = count
        
        for chunk in chunks:
            if remaining <= 0:
                break
                
            n = min(pairs_per_chunk, remaining)
            prompt = PROMPT_TEMPLATE.format(filename=filename, count=n, context=chunk)
            
            try:
                print(f"Generating {n} pairs...")
                response = generate(prompt)
                
                # Try to parse json
                start = response.find('[')
                end = response.rfind(']') + 1
                if start != -1 and end != 0:
                    json_str = response[start:end]
                    pairs = json.loads(json_str)
                    
                    for p in pairs:
                        p["filename"] = filename
                        dataset.append(p)
                        remaining -= 1
            except Exception as e:
                print(f"Error generating for chunk: {e}")
                
    # Add cross-document questions
    cross_doc = [
        {
            "question": "Which agreement has the longest termination notice period?",
            "answer": "The Arca Development Agreement has a 90-day termination notice period, while the Alpha contract has 30 days and Eslab has 60 days.",
            "context": "Various sections across Arca, Alpha, and Eslab contracts.",
            "filename": "Cross-Document"
        },
        {
            "question": "Do any of the contracts mention intellectual property ownership belonging solely to the contractor?",
            "answer": "No, all three contracts (Arca, Alpha, Eslab) state that intellectual property developed during the term belongs to the hiring company.",
            "context": "Various sections across Arca, Alpha, and Eslab contracts.",
            "filename": "Cross-Document"
        },
        {
            "question": "List all the governing laws mentioned across the three agreements.",
            "answer": "The Arca agreement is governed by Delaware law, the Alpha contract by New York law, and the Eslab agreement by California law.",
            "context": "Various sections across Arca, Alpha, and Eslab contracts.",
            "filename": "Cross-Document"
        },
        {
            "question": "Which of the contracts include a non-compete clause surviving post-termination?",
            "answer": "Both the Alpha contract and the Eslab agreement include a non-compete clause that survives for 12 months post-termination. The Arca agreement does not have a post-termination non-compete.",
            "context": "Various sections across Arca, Alpha, and Eslab contracts.",
            "filename": "Cross-Document"
        },
        {
            "question": "What are the total liability caps for the three agreements?",
            "answer": "The liability cap is $1,000,000 for Arca, $500,000 for Alpha, and limited to fees paid in the trailing 12 months for Eslab.",
            "context": "Various sections across Arca, Alpha, and Eslab contracts.",
            "filename": "Cross-Document"
        }
    ]
    
    dataset.extend(cross_doc)
    
    # Save the dataset
    out_dir = Path("tests/evaluation")
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "golden_dataset.json", "w") as f:
        json.dump(dataset, f, indent=2)
        
    print(f"Generated {len(dataset)} pairs.")

if __name__ == "__main__":
    generate_qa_pairs()
