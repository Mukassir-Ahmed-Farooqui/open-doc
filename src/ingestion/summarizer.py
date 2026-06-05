# src/ingestion/summarizer.py
import logging
from src.llm.groq_client import generate

logger = logging.getLogger(__name__)

def generate_section_summary(text: str) -> str:
    """Generate a brief 1-2 sentence summary of a section of a legal contract."""
    prompt = (
        "You are an expert legal assistant. Summarize the following section of a legal agreement "
        "briefly in 1-2 sentences, focusing on the core duties, rights, or conditions specified. "
        "Do not lose key specific numbers, dates, or parties:\n\n"
        f"{text}\n\nSummary:"
    )
    return generate(prompt).strip()

def generate_document_summary(combined_section_summaries: str) -> str:
    """Compile section summaries into a comprehensive document summary."""
    prompt = (
        "You are an expert legal assistant. Based on the following section summaries, "
        "write a comprehensive, structured summary of the entire agreement. "
        "Identify the parties, the core purpose of the agreement, and key obligations "
        "and termination rules in bullet points:\n\n"
        f"{combined_section_summaries}\n\nComprehensive Summary:"
    )
    return generate(prompt).strip()

def generate_summary_for_document(sections: list) -> str:
    """Generate a single unified summary for a list of SectionChunks."""
    if not sections:
        return "Empty document."
        
    logger.info(f"Generating section summaries for {len(sections)} sections...")
    sec_summaries = []
    for sec in sections:
        if len(sec.text.strip()) < 100:
            sec_summaries.append(f"Section {sec.heading}: {sec.text.strip()}")
        else:
            try:
                summary = generate_section_summary(sec.text)
                sec_summaries.append(f"Section {sec.heading}: {summary}")
            except Exception as e:
                logger.error(f"Failed to summarize section {sec.heading}: {e}")
                sec_summaries.append(f"Section {sec.heading}: {sec.text[:200]}...")
                
    combined = "\n".join(sec_summaries)
    logger.info("Compiling overall document summary...")
    try:
        return generate_document_summary(combined)
    except Exception as e:
        logger.error(f"Failed to compile document summary: {e}")
        return f"Comprehensive summary could not be fully compiled due to LLM error. Section outline:\n\n{combined[:1000]}"
