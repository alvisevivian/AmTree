import json
import numpy as np
from js import spiceBridge

def furnsh(path):
    return None

def str2et(value):
    return spiceBridge.str2et(value)

def spkpos(target, times, frame, correction, observer):
    scalar = np.isscalar(times)
    rows = [json.loads(spiceBridge.position(target, float(t), frame, correction, observer)) for t in ([times] if scalar else times)]
    positions = np.array([row['ptarg'] for row in rows])
    light = np.array([row['lt'] for row in rows])
    return (positions[0], light[0]) if scalar else (positions, light)

def pxfrm2(source, target, before, after):
    return np.array(json.loads(spiceBridge.rotation(source, target, float(before), float(after))))
