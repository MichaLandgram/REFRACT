import re
import os
import matplotlib.pyplot as plt

def parse_log(filename):
    data = []
    if not os.path.exists(filename):
        print(f"Warning: {filename} not found.")
        return data
    
    pattern = re.compile(r'\s*(\d+)\s+sec:.*?\s+([\d.,]+)\s+current\s+ops/sec')
    
    with open(filename, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            match = pattern.search(line)
            if match:
                sec = int(match.group(1))
                tp_str = match.group(2).replace(',', '.')
                tp = float(tp_str)
                data.append((sec, tp))
    
    data.sort(key=lambda x: x[0])
    return data

def parse_timeseries(filename):
    data = []
    if not os.path.exists(filename):
        print(f"Warning: {filename} not found.")
        return data
    
    pattern = re.compile(r'^\[READ\],\s*(\d+),\s*([\d.,]+)')
    
    with open(filename, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            match = pattern.match(line.strip())
            if match:
                offset_ms = int(match.group(1))
                sec = offset_ms / 1000.0
                
                lat_str = match.group(2).replace(',', '.')
                lat_us = float(lat_str)
                lat_ms = lat_us / 1000.0
                
                data.append((sec, lat_ms))
                
    data.sort(key=lambda x: x[0])
    return data

def main():
    dir_path = os.path.dirname(os.path.abspath(__file__))
    
    refract_file = os.path.join(dir_path, 'refract_smo_status.log')
    eager_file = os.path.join(dir_path, 'eager_smo_status.log')
    
    refract_stdout = os.path.join(dir_path, 'refract_stdout.log')
    eager_stdout = os.path.join(dir_path, 'eager_stdout.log')
    
    refract_data = parse_log(refract_file)
    eager_data = parse_log(eager_file)
    
    plt.figure(figsize=(10, 6), constrained_layout=True)
    has_data = False
    
    if refract_data:
        x_ref, y_ref = zip(*refract_data)
        plt.plot(x_ref, y_ref, label='REFRACT', color='#1E7EA2', marker='o', linewidth=2)
        has_data = True
        
    if eager_data:
        x_eag, y_eag = zip(*eager_data)
        plt.plot(x_eag, y_eag, label='Eager', color='#5B2C82', marker='s', linewidth=2)
        has_data = True
        
    if has_data:
        plt.axvline(x=3, color='#7f7f7f', linestyle='--', linewidth=1.5, label='SMO Triggered (3s)')
        
        # plt.title('Throughput Impact of Schema Migration Operation (SMO)', fontsize=14, fontweight='bold', pad=15)
        plt.xlabel('Time Elapsed (seconds)', fontsize=12)
        plt.ylabel('Throughput (ops/sec)', fontsize=12)
        plt.grid(True, linestyle=':', alpha=0.6)
        plt.legend(loc='upper left', fontsize=11)
        
        all_seconds = [s for s, _ in refract_data + eager_data]
        if all_seconds:
            plt.xlim(0, max(all_seconds) + 1)
            
        output_path = os.path.join(dir_path, 'smo_throughput_comparison.svg')
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        print(f"Successfully generated throughput plot: {output_path}")
        plt.close()
    
    refract_lat = parse_timeseries(refract_stdout)
    eager_lat = parse_timeseries(eager_stdout)
    
    plt.figure(figsize=(10, 6), constrained_layout=True)
    has_lat = False
    
    if refract_lat:
        x_ref_lat, y_ref_lat = zip(*refract_lat)
        plt.plot(x_ref_lat, y_ref_lat, label='REFRACT', color='#1E7EA2', linewidth=2)
        has_lat = True
        
    if eager_lat:
        x_eag_lat, y_eag_lat = zip(*eager_lat)
        plt.plot(x_eag_lat, y_eag_lat, label='Eager', color='#5B2C82', linewidth=2)
        has_lat = True
        
    if has_lat:
        plt.axvline(x=3, color='#7f7f7f', linestyle='--', linewidth=1.5, label='SMO Triggered (3s)')
        
        # plt.title('Read Latency (100ms Granularity) during Schema Migration (SMO)', fontsize=14, fontweight='bold', pad=15)
        plt.xlabel('Time Elapsed (seconds)', fontsize=12)
        plt.ylabel('Average Read Latency (ms)', fontsize=12)
        plt.grid(True, linestyle=':', alpha=0.6)
        plt.legend(loc='upper left', fontsize=11)
        
        max_y = max([y for _, y in refract_lat + eager_lat])
        if max_y > 100:
            plt.yscale('log')
            plt.ylabel('Average Read Latency', fontsize=12)
        
        all_sec_lat = [s for s, _ in refract_lat + eager_lat]
        if all_sec_lat:
            plt.xlim(0, max(all_sec_lat) + 0.1)
            
        output_path_lat = os.path.join(dir_path, 'smo_latency_comparison.svg')
        plt.savefig(output_path_lat, dpi=300, bbox_inches='tight')
        print(f"Successfully generated latency plot: {output_path_lat}")
        plt.close()

if __name__ == '__main__':
    main()
