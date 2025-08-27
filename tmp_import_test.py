import traceback
try:
    import main_api
    print('OK')
except Exception as e:
    traceback.print_exc()
    raise
