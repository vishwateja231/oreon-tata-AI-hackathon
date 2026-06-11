import json
from pathlib import Path

import networkx as nx

from app.config.settings import get_settings


class PlantGraphService:
    """
    Manages the directed dependency graph of plant assets.

    Nodes are asset IDs; a directed edge A → B means A feeds into B,
    so failure of A has downstream impact on B.
    """

    def __init__(self) -> None:
        self._graph: nx.DiGraph = nx.DiGraph()
        self._asset_meta: dict[str, dict] = {}
        self._load_graph()

    def _load_graph(self) -> None:
        settings = get_settings()
        graph_path = Path(settings.DATA_DIR) / "plant_graph.json"
        if not graph_path.exists():
            return
        with graph_path.open() as f:
            data = json.load(f)

        for node in data.get("nodes", []):
            self._graph.add_node(node["id"], **node)
            self._asset_meta[node["id"]] = node

        for edge in data.get("edges", []):
            self._graph.add_edge(edge["from"], edge["to"], relation=edge.get("relation", "feeds"))

    def get_downstream_assets(self, asset_id: str) -> list[str]:
        """Returns all asset IDs that are downstream (depend on) the given asset."""
        if asset_id not in self._graph:
            return []
        return list(nx.descendants(self._graph, asset_id))

    def get_upstream_assets(self, asset_id: str) -> list[str]:
        """Returns all asset IDs that the given asset depends on (upstream)."""
        if asset_id not in self._graph:
            return []
        return list(nx.ancestors(self._graph, asset_id))

    def get_impact_chain(self, asset_id: str) -> dict:
        """
        Calculates the full downstream impact chain if the given asset fails.

        Returns ordered list of affected assets with their dependency depth.
        """
        if asset_id not in self._graph:
            return {"asset_id": asset_id, "impact_chain": [], "total_affected": 0}

        downstream = nx.descendants(self._graph, asset_id)
        chain = []
        for node in downstream:
            try:
                depth = nx.shortest_path_length(self._graph, asset_id, node)
            except nx.NetworkXNoPath:
                depth = -1
            meta = self._asset_meta.get(node, {})
            chain.append({
                "asset_id": node,
                "depth": depth,
                "equipment_type": meta.get("equipment_type", "unknown"),
                "criticality": meta.get("criticality", "unknown"),
                "production_line": meta.get("production_line", "unknown"),
            })

        chain.sort(key=lambda x: x["depth"])
        return {
            "asset_id": asset_id,
            "impact_chain": chain,
            "total_affected": len(chain),
        }

    def get_direct_dependencies(self, asset_id: str) -> dict[str, list[str]]:
        """Returns immediate predecessors and successors of an asset."""
        predecessors = list(self._graph.predecessors(asset_id))
        successors = list(self._graph.successors(asset_id))
        return {"upstream": predecessors, "downstream": successors}

    def get_critical_path(self) -> list[str]:
        """Returns the longest dependency chain in the plant (critical path)."""
        if not self._graph.nodes:
            return []
        try:
            return nx.dag_longest_path(self._graph)
        except nx.NetworkXUnfeasible:
            return []

    def get_all_nodes(self) -> list[dict]:
        return [{"id": n, **self._asset_meta.get(n, {})} for n in self._graph.nodes]

    def get_all_edges(self) -> list[dict]:
        return [{"from": u, "to": v, **d} for u, v, d in self._graph.edges(data=True)]

    def reload(self) -> None:
        self._graph.clear()
        self._asset_meta.clear()
        self._load_graph()
