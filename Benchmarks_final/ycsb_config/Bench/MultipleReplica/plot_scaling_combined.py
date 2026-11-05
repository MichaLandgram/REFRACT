"""
Combined single-figure: GraphOnly vs FullRefract throughput scaling.
Style matched to Downtime/ReadOverhead plot_paper.py.

Usage:  python plot_scaling_combined.py
"""

import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as ticker
import numpy as np
from pathlib import Path

HERE = Path(__file__).parent

df_go = pd.read_csv(HERE / 'results_scaling' / 'scaling_results_graphOnly.csv')
df_fr = pd.read_csv(HERE / 'results_full_scaling' / 'scaling_results_fullRefract.csv')
df_go.columns = df_go.columns.str.strip()
df_fr.columns = df_fr.columns.str.strip()

OPS      = ['INSERT', 'READ', 'UPDATE', 'DELETE']
REPLICAS = sorted(df_go['replicas'].unique())

C_REFRACT = '#808080'
C_FULL    = '#1E7EA2'

n_replicas = len(REPLICAS)
gap        = 1.5
width      = 0.30

fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

tick_positions = []
tick_labels    = []

for oi, op in enumerate(OPS):
    group_start = oi * (n_replicas + gap)

    for ri, rep in enumerate(REPLICAS):
        xpos = group_start + ri

        go_row = df_go[(df_go['operation'] == op) & (df_go['replicas'] == rep)]
        fr_row = df_fr[(df_fr['operation'] == op) & (df_fr['replicas'] == rep)]
        v_go = go_row['combined_throughput_ops_sec'].values[0] if len(go_row) > 0 else 0
        v_fr = fr_row['combined_throughput_ops_sec'].values[0] if len(fr_row) > 0 else 0

        ax.bar(
            xpos - width / 2, v_go, width * 0.80,
            color=C_REFRACT, alpha=0.72,
            edgecolor='white', linewidth=0.8, zorder=3
        )
        ax.bar(
            xpos + width / 2, v_fr, width * 0.80,
            color=C_FULL, alpha=0.72,
            edgecolor='white', linewidth=0.8, zorder=3
        )

        tick_positions.append(xpos)
        tick_labels.append(str(rep))

    group_center = group_start + (n_replicas - 1) / 2
    ax.text(group_center, -0.06, op, transform=ax.get_xaxis_transform(),
            ha='center', va='top', fontsize=9, fontweight='bold', color='#333')

    if oi < len(OPS) - 1:
        sep_x = group_start + n_replicas + (gap - 1) / 2
        ax.axvline(sep_x, color='#ddd', linewidth=0.8, linestyle='-', zorder=1)

ax.set_xticks(tick_positions)
ax.set_xticklabels(tick_labels, fontsize=9)
# no xlabel — operation labels + replica numbers are self-explanatory
ax.set_ylabel('Combined Throughput (ops/sec)', fontsize=12)
ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f'{x:,.0f}'))
ax.grid(True, axis='y', alpha=0.25, linestyle='--', color='#ccc')

legend_handles = [
    mpatches.Patch(facecolor=C_FULL,    alpha=0.75, label='REFRACT'),
    mpatches.Patch(facecolor=C_REFRACT, alpha=0.75, label='GraphDB-CRDT'),
]
ax.legend(handles=legend_handles, fontsize=10.5, loc='upper left',
          framealpha=0.93, edgecolor='#ccc', facecolor='white')

out = HERE / 'scaling_combined.svg'
fig.savefig(out, dpi=300, bbox_inches='tight')
print(f'Saved {out}')
plt.close()
