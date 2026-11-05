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
    'removeR': '#e84c3d'
}

LABELS = {
    'createN': 'Create Node',
    'createR': 'Create Edge',
    'updateN': 'Update Node',
    'updateR': 'Update Edge',
    'removeN': 'Remove Node',
    'removeR': 'Remove Edge'
}

fig, ax = plt.subplots(figsize=(10, 6), constrained_layout=True)
fig.patch.set_facecolor('white')
ax.set_facecolor('white')

COLUMNS = ['createN', 'createR', 'updateN', 'updateR', 'removeN', 'removeR']

for col in COLUMNS:
    ax.plot(
        df['nodes'], 
        df[col],
        color=COLORS[col], 
        alpha=0.15,
        linewidth=1
    )
    
    smoothed = df[col].rolling(window=15, min_periods=1).mean()
    
    ax.plot(
        df['nodes'], 
        smoothed,
        color=COLORS[col], 
        linewidth=2.5, 
        label=LABELS[col]
    )

ax.set_title('Write Path Overhead (GraphDB Alone)', fontsize=12, fontweight='bold', pad=12)
ax.set_xlabel('Database Size (#Nodes)', fontsize=10.5)
ax.set_ylabel('Execution Time (ms)', fontsize=11)

# Format axes
ax.set_yscale('linear')
ax.set_ylim(bottom=0.1)


def x_formatter(x, pos):
    if x >= 1000:
        val = x / 1000
        if val.is_integer():
            return f"{int(val)}k"
        else:
            return f"{val:.1f}k"
    return str(int(x))

ax.xaxis.set_major_formatter(mticker.FuncFormatter(x_formatter))

# Set grid
ax.grid(True, which="major", linestyle="-", alpha=0.4, color="#ccc")
ax.grid(True, which="minor", linestyle=":", alpha=0.2, color="#ccc")

ax.legend(loc='upper left', fontsize=10, frameon=True, facecolor='white', edgecolor='#e5e5e5')


out_name = 'write_path_overhead_density.png'
out_path = HERE / out_name
fig.savefig(out_path, dpi=150, bbox_inches='tight')
print(f'Saved {out_name}')

plt.close()
