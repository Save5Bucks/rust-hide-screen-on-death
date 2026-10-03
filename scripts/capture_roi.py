"""
Fast ROI screen capture using PIL ImageGrab.
Captures only a specific region of the screen and outputs base64 image data.
"""
import sys
import json
import base64
from io import BytesIO
from PIL import ImageGrab, Image

# Ensure unbuffered output
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

def capture_region(monitor_index, x, y, width, height, resize_width=None, resize_height=None):
    """Capture a specific region of the screen, optionally resize it."""
    try:
        # Define bounding box (left, top, right, bottom)
        bbox = (x, y, x + width, y + height)
        
        # Capture the region using PIL
        img = ImageGrab.grab(bbox, all_screens=False)
        
        # Resize if requested (keeps data small!)
        if resize_width and resize_height:
            img = img.resize((resize_width, resize_height), Image.LANCZOS)
        
        # Convert to base64 for transmission
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        return img_base64, img.width, img.height
    except Exception as e:
        # Re-raise with more context
        raise Exception(f"ImageGrab capture failed: {str(e)}")

def main():
    """Main loop - reads commands from stdin, outputs captures to stdout."""
    while True:
        try:
            # Read command from stdin (JSON format)
            line = sys.stdin.readline()
            if not line:
                break
                
            command = json.loads(line.strip())
            callback_id = command.get('_id')
            
            if command.get('action') == 'capture':
                # Extract capture parameters
                monitor = command.get('monitor', 1)
                x = command.get('x', 0)
                y = command.get('y', 0)
                width = command.get('width', 200)
                height = command.get('height', 100)
                resize_width = command.get('resizeWidth')
                resize_height = command.get('resizeHeight')
                
                # Debug log
                print(f"DEBUG: Capture {width}x{height} at ({x},{y}), resize to {resize_width}x{resize_height}", file=sys.stderr, flush=True)
                
                # Capture the region
                img_data, actual_width, actual_height = capture_region(
                    monitor, x, y, width, height, resize_width, resize_height
                )
                
                # Debug log result
                print(f"DEBUG: Returning {actual_width}x{actual_height}", file=sys.stderr, flush=True)
                
                # Send back the result
                result = {
                    'success': True,
                    'data': img_data,
                    'width': actual_width,
                    'height': actual_height,
                    '_id': callback_id
                }
                print(json.dumps(result), flush=True)
                
            elif command.get('action') == 'ping':
                # Health check
                print(json.dumps({'success': True, 'message': 'pong', '_id': callback_id}), flush=True)
                
            elif command.get('action') == 'exit':
                break
                
        except Exception as e:
            # Return error to Node.js
            error_result = {
                'success': False,
                'error': str(e),
                '_id': callback_id if 'callback_id' in locals() else None
            }
            print(json.dumps(error_result), flush=True)
            # Log to stderr for debugging
            print(f"Error: {str(e)}", file=sys.stderr, flush=True)

if __name__ == '__main__':
    main()
