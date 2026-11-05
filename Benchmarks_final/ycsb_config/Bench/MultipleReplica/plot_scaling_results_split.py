"""
Usage:
    python plot_scaling_results_split.py results_scaling/scaling_results_graphOnly.csv
    python plot_scaling_results_split.py results_full_scaling/scaling_results_fullRefract.csv
    python plot_scaling_results_split.py results_scaling/scaling_results_graphOnly.csv results_full_scaling/scaling_results_fullRefract.csv

Generates one figure per operation (INSERT, UPDATE, READ, DELETE)
instead of combining all operations into a single plot.
"""

import sys
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

COLORS = {
    'INSERT': '#2b5c8f',
    'UPDATE': '#d97d24',
    'READ':   '#27ae60',
    'DELETE': '#c0392b',
}

SYSTEM_LABELS = {
    'graphOnly':   'REFRACT w/o SchemaLens',
    'fullRefract': 'REFRACT w/ SchemaLens',
}

def load_csv(path):
    df = pd.read_csv(path)
    df.columns = df.columns.str.strip()
    return df

def plot_single_system(df, system_name, out_dir):
    """Plot throughput + latency for a single system, one figure per operation."""
    ops = df['operation'].unique()
    label = SYSTEM_LABELS.get(system_name, system_name)

    for op in ops:
        subset = df[df['operation'] == op].sort_values('replicas')
        if subset.empty:
            continue
        replicas = sorted(subset['replicas'].unique())
        color = COLORS.get(op, None)

        # --- Throughput ---
        fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
        ax.plot(subset['replicas'], subset['combined_throughput_ops_sec'], 'o-',
                label=op, color=color, linewidth=2, markersize=8)
        for rx, val in zip(subset['replicas'], subset['combined_throughput_ops_sec']):
            ax.annotate(f'{val:.0f}', (rx, val), textcoords="offset points",
                        xytext=(0, 10), ha='center', fontsize=7)

        ax.set_xlabel('Number of Replicas')
        ax.set_ylabel('Combined Throughput (ops/sec)')
        ax.set_title(f'{label} — {op} Throughput Scaling')
        ax.set_xticks(replicas)
        ax.legend()
        ax.grid(alpha=0.3)

        fname = f'{out_dir}/throughput_{system_name}_{op.lower()}.svg'
        fig.savefig(fname, dpi=300, bbox_inches='tight')
        plt.close(fig)
        print(f"Saved: {fname}")

        # --- Average Latency ---
        fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
        ax.plot(subset['replicas'], subset['avg_latency_us'] / 1000, 'o-',
                label=op, color=color, linewidth=2, markersize=8)

        ax.set_xlabel('Number of Replicas')
        ax.set_ylabel('Average Latency (ms)')
        ax.set_title(f'{label} — {op} Average Latency vs Replicas')
        ax.set_xticks(replicas)
        ax.legend()
        ax.grid(alpha=0.3)
        fname = f'{out_dir}/latency_avg_{system_name}_{op.lower()}.svg'
        fig.savefig(fname, dpi=150, bbox_inches='tight')
        plt.close(fig)
        print(f"Saved: {fname}")

        # --- p99 Latency ---
        fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
        ax.plot(subset['replicas'], subset['p99_latency_us'] / 1000, 's--',
                label=f'{op} (p99)', color=color, linewidth=2, markersize=8)

        ax.set_xlabel('Number of Replicas')
        ax.set_ylabel('p99 Latency (ms)')
        ax.set_title(f'{label} — {op} p99 Latency vs Replicas')
        ax.set_xticks(replicas)
        ax.legend()
        ax.grid(alpha=0.3)
        fname = f'{out_dir}/latency_p99_{system_name}_{op.lower()}.svg'
        fig.savefig(fname, dpi=150, bbox_inches='tight')
        plt.close(fig)
        print(f"Saved: {fname}")


def plot_comparison(dfs, out_dir):
    """Plot comparison of two systems, one figure per operation."""
    ops = ['INSERT', 'UPDATE', 'READ', 'DELETE']
    all_replicas = sorted(dfs[list(dfs.keys())[0]]['replicas'].unique())

    for op in ops:
        fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
        for system_name, df in dfs.items():
            subset = df[df['operation'] == op].sort_values('replicas')
            if subset.empty:
                continue
            label = SYSTEM_LABELS.get(system_name, system_name)
            linestyle = '-' if system_name == 'graphOnly' else '--'
            ax.plot(subset['replicas'], subset['combined_throughput_ops_sec'], 'o' + linestyle,
                    label=label, linewidth=2, markersize=8)

        # ax.set_title(f'{op} - Throughput Scaling Comparison', fontsize=14, fontweight='bold')
        ax.set_xlabel('Replicas')
        ax.set_ylabel('Throughput (ops/sec)')
        ax.set_xticks(all_replicas)
        ax.legend(fontsize=10)
        ax.grid(alpha=0.3)
        fname = f'{out_dir}/scaling_comparison_{op.lower()}.svg'
        fig.savefig(fname, dpi=300, bbox_inches='tight')
        plt.close(fig)
        print(f"Saved: {fname}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python plot_scaling_results_split.py <csv_path> [csv_path2]")
        sys.exit(1)

    dfs = {}
    out_dir = str(Path(sys.argv[1]).parent)

    for csv_path in sys.argv[1:]:
        df = load_csv(csv_path)
        system = df['system'].iloc[0]
        dfs[system] = df
        plot_single_system(df, system, str(Path(csv_path).parent))

    if len(dfs) > 1:
        plot_comparison(dfs, out_dir)
