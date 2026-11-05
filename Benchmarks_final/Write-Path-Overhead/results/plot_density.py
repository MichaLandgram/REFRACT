import json
import pathlib
import shutil
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

HERE = pathlib.Path(__file__).parent
results_file = HERE / 'results_density.json'

if not results_file.exists():
    print(f"Error: {results_file} not found. Run the benchmark first!")
    exit(1)

data = json.loads(results_file.read_text())
df = pd.DataFrame(data['results'])

COLORS = {
    'createN': '#2b5c8f',
    'createR': '#4682b4',
    'updateN': '#d97d24',
    'updateR': '#f2ad4e',
    'removeN': '#c0392b',
    'removeR': '#e84c3d',
    'readN': '#27ae60',
    'readR': '#2ecc71'
}

LABELS = {
    'createN': 'Create Node',
    'createR': 'Create Edge',
    'updateN': 'Update Node',
    'updateR': 'Update Edge',
    'removeN': 'Remove Node',
    'removeR': 'Remove Edge',
    'readN': 'Read Node',
    'readR': 'Read Edge'
}

fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

COLUMNS = ['createN', 'createR', 'updateN', 'updateR', 'removeN', 'removeR', 'readN', 'readR']

for col in COLUMNS:
    ax.plot(
        df['nodes'], 
        df[col],
        color=COLORS[col], 
        alpha=0.15,
        linewidth=1
    )
    
    # moving average smoothing with a window of 15 for better visibility
    smoothed = df[col].rolling(window=15, min_periods=1).mean()
    
    ax.plot(
        df['nodes'], 
        smoothed,
        color=COLORS[col], 
        linewidth=2.5, 
        label=LABELS[col]
    )

ax.set_title('GraphDB Alone', fontsize=12, fontweight='bold', pad=12)
ax.set_xlabel('Database Size (#Nodes)', fontsize=10.5)
ax.set_ylabel('Average Execution Time (ms)', fontsize=11)


ax.set_yscale('linear')
# currently hardcoded, but can be adjusted based on the data range
# ax.set_ylim(bottom=0.1, top=1.2)


def x_formatter(x, pos):
    if x >= 1000:
        val = x / 1000
        if val.is_integer():
            return f"{int(val)}k"
        else:
            return f"{val:.1f}k"
    return str(int(x))

ax.xaxis.set_major_formatter(mticker.FuncFormatter(x_formatter))

ax.grid(True, which="major", linestyle="-", alpha=0.4, color="#ccc")
ax.grid(True, which="minor", linestyle=":", alpha=0.2, color="#ccc")

ax.legend(loc='upper left', fontsize=10, frameon=True, facecolor='white', edgecolor='#e5e5e5')


fig.canvas.draw()
node_ticks = ax.get_xticks()
max_n = df['nodes'].max()
node_ticks = [t for t in node_ticks if 0 <= t <= max_n]

edge_ticks = []
for n in node_ticks:
    if n == 0:
        edge_ticks.append(0)
    else:
        nearest_row = df.iloc[(df['nodes'] - n).abs().argsort()[:1]].iloc[0]
        edge_ticks.append(int(nearest_row['edges']))

secax = ax.secondary_xaxis('top')
secax.set_ticks(node_ticks)
secax.xaxis.set_ticklabels([f"{e}" for e in edge_ticks])
secax.set_xlabel('Database Size (#Edges)', fontsize=10.5, labelpad=8)


out_name = 'write_path_overhead_density.png'
out_path = HERE / out_name
fig.savefig(out_path, dpi=150, bbox_inches='tight')
print(f'Saved {out_name}')

plt.close()