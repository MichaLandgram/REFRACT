import json
import pathlib
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

HERE = pathlib.Path(__file__).parent

graphdb_file = HERE / 'results_density.json'
refract_v0_file = HERE / 'results_Fulldensity_v0.json'

for name, f in [("GraphDB Alone", graphdb_file), ("REFRACT V0", refract_v0_file)]:
    if not f.exists():
        print(f"Warning: {name} results file not found at {f}. Plotting may fail if files are missing.")

def load_df(path):
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return pd.DataFrame(data['results'])

df_db = load_df(graphdb_file)
df_v0 = load_df(refract_v0_file)

OPS = {
    'createN': 'Create Node',
    'createR': 'Create Edge',
    'updateN': 'Update Node',
    'updateR': 'Update Edge',
    'removeN': 'Remove Node',
    'removeR': 'Remove Edge',
    'readN':   'Read Node',
    'readR':   'Read Edge',
}

COLORS = {
    'db': '#2b5c8f',
    'v0': "#15FF00",
}

fig, axes = plt.subplots(4, 2, figsize=(12, 14), sharex=True, constrained_layout=True)
fig.patch.set_facecolor('white')

legend_handles = []
legend_labels = []

SMOOTH_WINDOW = 15

for idx, (col_name, title) in enumerate(OPS.items()):
    row = idx // 2
    col = idx % 2
    ax = axes[row, col]
    ax.set_facecolor('white')
    
    smoothed_db = None
    smoothed_v0 = None
    
    if df_db is not None and col_name in df_db.columns:
        ax.plot(df_db['nodes'], df_db[col_name], color=COLORS['db'], alpha=0.12, linewidth=0.8)
        smoothed_db = df_db[col_name].rolling(window=SMOOTH_WINDOW, min_periods=1).mean()
        h_db, = ax.plot(df_db['nodes'], smoothed_db, color=COLORS['db'], linewidth=2)
        if idx == 0:
            legend_handles.append(h_db)
            legend_labels.append('GraphCRDT (Baseline)')
            
    if df_v0 is not None and col_name in df_v0.columns:
        ax.plot(df_v0['nodes'], df_v0[col_name], color=COLORS['v0'], alpha=0.12, linewidth=0.8)
        smoothed_v0 = df_v0[col_name].rolling(window=SMOOTH_WINDOW, min_periods=1).mean()
        h_v0, = ax.plot(df_v0['nodes'], smoothed_v0, color=COLORS['v0'], linewidth=2, linestyle='--')
        if idx == 0:
            legend_handles.append(h_v0)
            legend_labels.append('REFRACT')
            
    overhead_text = ""
    if smoothed_db is not None and smoothed_v0 is not None:
        overhead = (smoothed_v0 - smoothed_db) / smoothed_db
        max_oh = max(0.0, overhead.max())
        overhead_text = f"Max Overhead: +{max_oh:.1%}"

    if overhead_text:
        ax.text(
            0.05, 0.92, 
            overhead_text, 
            transform=ax.transAxes, 
            ha='left', va='top', 
            fontsize=8.5, 
            fontweight='bold', 
            color='#333333', 
            bbox=dict(boxstyle='round,pad=0.25', facecolor='#fbfbfb', alpha=0.9, edgecolor='#cccccc')
        )
            
    ax.set_title(title, fontsize=11, fontweight='bold', pad=8)
    ax.set_yscale('linear')
    ax.set_ylim(bottom=0.1, top=0.9)
    
    ax.grid(True, which="major", linestyle="-", alpha=0.4, color="#ccc")
    ax.grid(True, which="minor", linestyle=":", alpha=0.2, color="#ccc")
    
    if row == 0:
        fig.canvas.draw()
        node_ticks = ax.get_xticks()
        active_df = df_db if df_db is not None else df_v0
        if active_df is not None:
            max_n = active_df['nodes'].max()
            node_ticks = [t for t in node_ticks if 0 <= t <= max_n]
            edge_ticks = []
            for n in node_ticks:
                if n == 0:
                    edge_ticks.append(0)
                else:
                    nearest_row = active_df.iloc[(active_df['nodes'] - n).abs().argsort()[:1]].iloc[0]
                    edge_ticks.append(int(nearest_row['edges']))
            
            secax = ax.secondary_xaxis('top')
            secax.set_ticks(node_ticks)
            secax.xaxis.set_ticklabels([f"{e}" for e in edge_ticks])
            secax.set_xlabel('Database Size (#Edges)', fontsize=9.5, labelpad=8)
    
    if col == 0:
        ax.set_ylabel('Execution Time (ms)', fontsize=10)
    if row == 3:
        ax.set_xlabel('Database Size (#Nodes)', fontsize=10)

fig.legend(
    legend_handles, 
    legend_labels, 
    loc='lower center', 
    ncol=2, 
    fontsize=10.5, 
    frameon=True, 
    facecolor='white', 
    edgecolor='#e5e5e5',
    bbox_to_anchor=(0.5, 0.02)
)



out_name = 'write_path_comparison_grid.svg'
out_path = HERE / out_name
fig.savefig(out_path, dpi=300, bbox_inches='tight')
print(f'Saved grid chart to {out_name}')

plt.close()
