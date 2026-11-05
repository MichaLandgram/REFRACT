"""
Usage:
    python plot_scaling_results.py results_scaling/scaling_results_graphOnly.csv
    python plot_scaling_results.py results_full_scaling/scaling_results_fullRefract.csv
    python plot_scaling_results.py results_scaling/scaling_results_graphOnly.csv results_full_scaling/scaling_results_fullRefract.csv
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
    """Plot throughput + latency for a single system."""
    ops = df['operation'].unique()
    replicas = sorted(df['replicas'].unique())
    x = np.arange(len(replicas))
    width = 0.18

    label = SYSTEM_LABELS.get(system_name, system_name)

    fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
    for op in ops:
        subset = df[df['operation'] == op].sort_values('replicas')
        ax.plot(subset['replicas'], subset['combined_throughput_ops_sec'], 'o-',
                label=op, color=COLORS.get(op, None), linewidth=2, markersize=8)
        for rx, val in zip(subset['replicas'], subset['combined_throughput_ops_sec']):
            ax.annotate(f'{val:.0f}', (rx, val), textcoords="offset points",
                        xytext=(0, 10), ha='center', fontsize=7)

    ax.set_xlabel('Number of Replicas')
    ax.set_ylabel('Combined Throughput (ops/sec)')
    ax.set_title(f'{label} — Throughput Scaling')
    ax.set_xticks(replicas)
    ax.legend()
    ax.grid(alpha=0.3)

    fig.savefig(f'{out_dir}/throughput_{system_name}.svg', dpi=300, bbox_inches='tight')
    plt.close(fig)
    print(f"Saved: {out_dir}/throughput_{system_name}.svg")

    fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
    for op in ops:
        subset = df[df['operation'] == op].sort_values('replicas')
        ax.plot(subset['replicas'], subset['avg_latency_us'] / 1000, 'o-',
                label=op, color=COLORS.get(op, None), linewidth=2, markersize=8)

    ax.set_xlabel('Number of Replicas')
    ax.set_ylabel('Average Latency (ms)')
    ax.set_title(f'{label} — Average Latency vs Replicas')
    ax.set_xticks(replicas)
    ax.legend()
    ax.grid(alpha=0.3)

    fig.savefig(f'{out_dir}/latency_avg_{system_name}.svg', dpi=150, bbox_inches='tight')
    plt.close(fig)
    print(f"Saved: {out_dir}/latency_avg_{system_name}.svg")

    fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
    for op in ops:
        subset = df[df['operation'] == op].sort_values('replicas')
        ax.plot(subset['replicas'], subset['p99_latency_us'] / 1000, 's--',
                label=f'{op} (p99)', color=COLORS.get(op, None), linewidth=2, markersize=8)

    ax.set_xlabel('Number of Replicas')
    ax.set_ylabel('p99 Latency (ms)')
    ax.set_title(f'{label} — p99 Latency vs Replicas')
    ax.set_xticks(replicas)
    ax.legend()
    ax.grid(alpha=0.3)

    fig.savefig(f'{out_dir}/latency_p99_{system_name}.svg', dpi=150, bbox_inches='tight')
    plt.close(fig)
    print(f"Saved: {out_dir}/latency_p99_{system_name}.svg")


def plot_comparison(dfs, out_dir):
    """Plot side-by-side comparison of two systems."""
    ops = ['INSERT', 'UPDATE', 'READ', 'DELETE']

    fig, axes = plt.subplots(2, 2, figsize=(14, 10), constrained_layout=True)
    axes = axes.flatten()

    for idx, op in enumerate(ops):
        ax = axes[idx]
        for system_name, df in dfs.items():
            subset = df[df['operation'] == op].sort_values('replicas')
            if subset.empty:
                continue
            label = SYSTEM_LABELS.get(system_name, system_name)
            linestyle = '-' if system_name == 'graphOnly' else '--'
            ax.plot(subset['replicas'], subset['combined_throughput_ops_sec'], 'o' + linestyle,
                    label=label, linewidth=2, markersize=8)

        ax.set_title(f'{op}')
        ax.set_xlabel('Replicas')
        ax.set_ylabel('Throughput (ops/sec)')
        ax.set_xticks(sorted(dfs[list(dfs.keys())[0]]['replicas'].unique()))
        ax.legend(fontsize=8)
        ax.grid(alpha=0.3)

    plt.suptitle('Throughput Scaling Comparison', fontsize=14, fontweight='bold')

    fig.savefig(f'{out_dir}/scaling_comparison.svg', dpi=300, bbox_inches='tight')
    plt.close(fig)
    print(f"Saved: {out_dir}/scaling_comparison.svg")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python plot_scaling_results.py <csv_path> [csv_path2]")
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
