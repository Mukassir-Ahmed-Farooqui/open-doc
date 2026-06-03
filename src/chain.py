
# src/chain.py

from src.llm.groq_client import generate
from src.prompts.legal_qa import LEGAL_QA_PROMPT
from src.retrieval.retriever import HierarchicalRetriever
from src.storage.qdrant_store import (
    get_client,
    get_embedder,
)


class LegalRAG:

    def __init__(self):
        self.retriever = HierarchicalRetriever(
            get_client(),
            get_embedder(),
        )

    def ask(self, question: str):

        results = self.retriever.retrieve(question)

        context = "\n\n".join(
            f"""
Document: {chunk.filename}
Section: {chunk.heading}
Page: {chunk.page_num}

{chunk.text}
"""
            for chunk in results.sentences
        )

        prompt = LEGAL_QA_PROMPT.format(
            context=context,
            question=question,
        )

        answer = generate(prompt)

        citations = []

        seen = set()

        for chunk in results.sentences:

            key = (
                chunk.page_num,
                chunk.heading,
            )

            if key in seen:
                continue

            seen.add(key)

            citations.append(
                {
                    "document": chunk.filename,
                    "page": chunk.page_num,
                    "section": chunk.heading,
                }
            )

        return {
            "answer": answer,
            "citations": citations,
        }