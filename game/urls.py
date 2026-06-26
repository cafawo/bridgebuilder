from django.urls import path

from game import views

app_name = "game"

urlpatterns = [
    path("", views.index, name="home"),
    path("levels/index.json", views.level_index, name="level-index"),
    path("levels/<slug:level_name>.json", views.level_json, name="level-json"),
    path("levels/random/<slug:seed>.json", views.random_level_json, name="random-level"),
]
