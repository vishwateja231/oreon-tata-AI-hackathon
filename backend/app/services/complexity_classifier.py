"""Complexity Classifier for OREON.

Classifies incoming queries into 'simple' or 'complex' to route them
to the appropriate LLM (Nemotron Super vs Nemotron Ultra).
"""

import logging

logger = logging.getLogger(__name__)

class ComplexityClassifier:
    # Keywords indicating a complex analytical request
    COMPLEX_KEYWORDS = [
        "root cause", "rca", "why", "diagnose", "diagnosis", "failure", 
        "analyze", "analysis", "compare", "impact", "predict", "forecast",
        "remaining useful life", "rul", "trend", "degradation", "investigate",
        "what if", "scenario", "recommend a plan", "trade-off", "cascade",
        "downstream", "correlat", "hypothesi", "should we", "cost of"
    ]

    # Keywords indicating a simple informational request
    SIMPLE_KEYWORDS = [
        "what is", "define", "definition", "list", "show", "status of",
        "how do i", "where is", "when", "sop for", "procedure for", "spec",
        "rating", "threshold"
    ]

    @classmethod
    def classify(cls, query: str) -> str:
        """
        Classifies the query.
        Returns:
            "complex" if the query requires deep reasoning/analysis.
            "simple" if the query is a simple lookup/definition/informational.
        """
        q = (query or "").lower().strip()
        
        # Rule 1: Empty or extremely short queries default to simple
        if not q or len(q) < 8:
            return "simple"
            
        # Rule 2: Check for explicit complex keywords
        for kw in cls.COMPLEX_KEYWORDS:
            if kw in q:
                logger.info(f"Classified query as COMPLEX due to keyword: '{kw}'")
                return "complex"

        # Rule 3: Check for simple keywords with a relatively short length
        for kw in cls.SIMPLE_KEYWORDS:
            if kw in q and len(q) < 120:
                logger.info(f"Classified query as SIMPLE due to keyword: '{kw}'")
                return "simple"

        # Rule 4: Structural heuristics (long, multi-part, or multiple questions)
        word_count = len(q.split())
        if word_count >= 20 or q.count("?") > 1 or (" and " in q and word_count >= 14):
            logger.info("Classified query as COMPLEX due to length/structure.")
            return "complex"

        # Default to simple for general assistant interaction
        return "simple"
