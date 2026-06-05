import json
import argparse
import os
from pathlib import Path

from datasets import Dataset
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall
)

from src.chain import LegalRAG

load_dotenv()

def load_dataset(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def run_evaluation(dataset_path: str, output_path: str):
    print(f"Loading dataset from {dataset_path}...")
    qa_pairs = load_dataset(dataset_path)
    
    rag = LegalRAG()
    
    cache_file = "tests/evaluation/generation_cache.json"
    if os.path.exists(cache_file):
        print("Loading generation cache...")
        with open(cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        questions = []
        ground_truths = []
        answers = []
        contexts = []
        
        print("Running pipeline on golden dataset...")
        for item in qa_pairs:
            question = item["question"]
            print(f"Q: {question}")
            
            # Execute the RAG pipeline with retry
            import time
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    result = rag.ask(question)
                    break
                except Exception as e:
                    print(f"Error on attempt {attempt+1}: {e}")
                    if attempt == max_retries - 1:
                        result = {"answer": "Error", "contexts": []}
                    time.sleep(2)
            
            questions.append(question)
            ground_truths.append(item["answer"])
            answers.append(result["answer"])
            contexts.append(result["contexts"])
            time.sleep(1) # Add a small delay between questions to avoid rate limits
            
        data = {
            "question": questions,
            "answer": answers,
            "contexts": contexts,
            "ground_truth": ground_truths
        }
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    
    dataset = Dataset.from_dict(data)
    
    # Configure Gemini judge
    print("Evaluating with RAGAS (Judge: Gemini Flash)...")
    judge_llm = LangchainLLMWrapper(
        ChatGoogleGenerativeAI(
            model="gemini-1.5-flash-latest",
            google_api_key=os.environ.get("GEMINI_API_KEY")
        )
    )
    
    # RAGAS still needs an embeddings model to compute answer relevancy
    # BAAI/bge-small-en-v1.5 from HuggingFace can be wrapped via langchain.
    # However, standard practice is to use OpenAI embeddings if we have the key,
    # or just use HuggingFace. Let's use OpenAI since it's most robust for the judge,
    # or we can use our bge model for evaluation too.
    # We will use HuggingFace if OPENAI_API_KEY is not available, but let's try OpenAI.
    from langchain_huggingface import HuggingFaceEmbeddings
    judge_embeddings = LangchainEmbeddingsWrapper(
        HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
    )
    
    metrics = [
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall
    ]
    
    results = evaluate(
        dataset,
        metrics=metrics,
        llm=judge_llm,
        embeddings=judge_embeddings,
    )
    
    df = results.to_pandas()
    scores = df.to_dict(orient="records")
    summary = {
        "faithfulness": float(df["faithfulness"].mean()) if "faithfulness" in df.columns else 0,
        "answer_relevancy": float(df["answer_relevancy"].mean()) if "answer_relevancy" in df.columns else 0,
        "context_precision": float(df["context_precision"].mean()) if "context_precision" in df.columns else 0,
        "context_recall": float(df["context_recall"].mean()) if "context_recall" in df.columns else 0,
    }
    
    print("\nBaseline Results:")
    print(json.dumps(summary, indent=2))
    
    output = {
        "summary": summary,
        "details": scores
    }
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved results to {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", type=str, help="Path to baseline scores to compare against")
    args = parser.parse_args()
    
    # Check if dataset exists
    dataset_path = "tests/evaluation/golden_dataset.json"
    output_path = "tests/evaluation/baseline_scores.json"
    
    if not os.path.exists(dataset_path):
        print(f"Error: {dataset_path} not found. Please run the generation script first.")
        exit(1)
        
    run_evaluation(dataset_path, output_path)
